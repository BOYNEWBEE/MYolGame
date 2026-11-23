// 社区模板路由复用业务层的鉴权与响应，不接收模型、命令或密钥配置。
import type { HandlerDeps, Route } from './handler.ts';
import type { Project, Session, Version } from './store.ts';
import type { CreationTemplate, CreationTemplatePublic, TemplateOrigin } from './shared/creation-template.ts';
import { compileTemplatePrompt, parseParameters, retainAttributions, templateText } from './shared/creation-template.ts';
import { embedGamePolicy, validateArtifact } from './shared/artifact.ts';

interface Helpers {
  authenticate(deps: HandlerDeps, req: Request, required: boolean): Promise<Session | null>;
  getOwnedProject(deps: HandlerDeps, id: string, session: Session): Promise<Project>;
  readBody(req: Request): Promise<Record<string, unknown>>;
  json(data: unknown, status?: number): Response;
  gameHtmlResponse(html: string): Response;
  projectSummary(project: Project): Record<string, unknown>;
  versionSummary(version: Version): Record<string, unknown>;
}

function reject(status: number, code: string, message: string): never { throw { status, code, message }; }
function knownFields(body: Record<string, unknown>, fields: string[]): void {
  if (Object.keys(body).some((key) => !fields.includes(key))) reject(400, 'invalid_template', '包含不支持的模板字段');
}
function summary(template: CreationTemplate, token?: string): CreationTemplatePublic {
  const { ownerToken, html: _html, ...visible } = template;
  return { ...visible, owned: ownerToken === token };
}

export function buildCommunityRoutes(h: Helpers): Route[] {
  async function accessible(deps: HandlerDeps, req: Request, id: string): Promise<{ template: CreationTemplate; session: Session | null }> {
    const session = await h.authenticate(deps, req, false);
    const template = await deps.store.getCreationTemplate(id);
    if (!template || (!template.published && template.ownerToken !== session?.token)) reject(404, 'template_not_found', '创作模板不存在或已下架');
    return { template, session };
  }
  return [
    {
      method: 'GET', pattern: /^\/api\/templates$/,
      handle: async ({ deps, req, query }) => {
        const mine = query.get('mine') === 'true';
        const session = await h.authenticate(deps, req, mine);
        const kind = query.get('kind');
        const limit = Math.min(24, Math.max(1, Math.floor(Number(query.get('limit')) || 12)));
        const offset = Math.max(0, Math.floor(Number(query.get('offset')) || 0));
        const result = await deps.store.listCreationTemplates({
          q: (query.get('q') || '').trim().slice(0, 60),
          kind: kind === 'official' || kind === 'community' ? kind : undefined,
          ownerToken: mine ? session!.token : undefined, limit, offset,
        });
        return h.json({ items: result.items.map((t) => summary(t, session?.token)), total: result.total, limit, offset });
      },
    },
    {
      method: 'GET', pattern: /^\/api\/templates\/([^/]+)$/,
      handle: async ({ deps, req, params }) => {
        const { template, session } = await accessible(deps, req, params[0]!);
        return h.json({ template: summary(template, session?.token), agentAvailable: Boolean(deps.agent) });
      },
    },
    {
      method: 'GET', pattern: /^\/api\/templates\/([^/]+)\/play$/,
      handle: async ({ deps, req, params }) => {
        const { template } = await accessible(deps, req, params[0]!);
        return h.gameHtmlResponse(template.html);
      },
    },
    {
      method: 'POST', pattern: /^\/api\/projects\/([^/]+)\/templates$/,
      handle: async ({ deps, req, params }) => {
        const session = (await h.authenticate(deps, req, true))!;
        const project = await h.getOwnedProject(deps, params[0]!, session);
        const body = await h.readBody(req);
        knownFields(body, ['versionId', 'title', 'description', 'prompt', 'parameters', 'license', 'versionLabel', 'rightsConfirmed']);
        if (body.rightsConfirmed !== true || body.license !== 'MIT') reject(400, 'license_required', '请确认有权以 MIT 许可公开源码与所含素材');
        const versionId = templateText(body.versionId, '示例版本', 64);
        const version = await deps.store.getVersion(versionId);
        if (!version || version.projectId !== project.id) reject(404, 'version_not_found', '示例版本不属于当前项目');
        const prompt = templateText(body.prompt, '创作需求', 1200);
        const parameters = parseParameters(body.parameters);
        compileTemplatePrompt({ prompt, parameters }, {});
        const html = embedGamePolicy(version.html);
        validateArtifact(html);
        const template: CreationTemplate = {
          id: crypto.randomUUID(), ownerToken: session.token,
          title: templateText(body.title, '模板标题', 48),
          description: templateText(body.description, '模板介绍', 500), prompt, parameters,
          license: 'MIT', versionLabel: templateText(body.versionLabel || '1.0', '模板版本', 20),
          authorName: session.nickname, official: false, published: true,
          sourceVersionNote: version.note, spec: structuredClone(version.spec), html,
          generationMode: version.generationMode,
          verification: version.checks?.browser === 'passed' ? 'browser-smoke' : version.generationMode === 'template' ? 'template-render' : 'unverified',
          attributions: structuredClone(version.templateOrigin?.attributions || []),
          createdAt: new Date().toISOString(),
        };
        await deps.store.createCreationTemplate(template);
        return h.json({ template: summary(template, session.token) }, 201);
      },
    },
    {
      method: 'POST', pattern: /^\/api\/templates\/([^/]+)\/visibility$/,
      handle: async ({ deps, req, params }) => {
        const session = (await h.authenticate(deps, req, true))!;
        const template = await deps.store.getCreationTemplate(params[0]!);
        if (!template) reject(404, 'template_not_found', '创作模板不存在');
        if (template.ownerToken !== session.token) reject(403, 'forbidden', '只能管理自己发布的模板');
        const body = await h.readBody(req);
        knownFields(body, ['published']);
        if (typeof body.published !== 'boolean') reject(400, 'invalid_template', 'published 必须为布尔值');
        await deps.store.setCreationTemplatePublished(template.id, body.published);
        return h.json({ published: body.published });
      },
    },
    {
      method: 'POST', pattern: /^\/api\/templates\/([^/]+)\/use$/,
      handle: async ({ deps, req, params }) => {
        const session = (await h.authenticate(deps, req, true))!;
        const { template } = await accessible(deps, req, params[0]!);
        const body = await h.readBody(req);
        knownFields(body, ['mode', 'values', 'extraPrompt']);
        if (body.mode !== 'copy' && body.mode !== 'customize') reject(400, 'invalid_template', '请选择原样套用或按参数生成');
        if (body.mode === 'customize' && !deps.agent) reject(409, 'agent_required', '当前未启用源码开发，可先原样套用示例');
        if (body.mode === 'copy' && (body.values !== undefined || body.extraPrompt !== undefined)) reject(400, 'invalid_template', '原样套用不接受修改参数，请使用按参数生成');
        const extra = body.extraPrompt === undefined || body.extraPrompt === '' ? '' : templateText(body.extraPrompt, '补充需求', 500);
        const compiled = compileTemplatePrompt(template, body.values, extra);
        if (template.attributions.length >= 12) reject(400, 'invalid_template', '来源层级过多，请选择较早的原始模板');
        const origin: TemplateOrigin = {
          templateId: template.id, title: template.title, versionLabel: template.versionLabel,
          parameters: compiled.values,
          attributions: [...structuredClone(template.attributions), { templateId: template.id, title: template.title,
            versionLabel: template.versionLabel, authorName: template.authorName, license: template.license }],
        };
        const now = new Date().toISOString();
        const project: Project = { id: crypto.randomUUID(), ownerToken: session.token, title: template.spec.title,
          spec: structuredClone(template.spec), currentVersionId: crypto.randomUUID(), visibility: 'private', gameId: null,
          allowDownload: true, createdAt: now, updatedAt: now, templateOrigin: origin };
        const html = retainAttributions(template.html, origin);
        validateArtifact(html);
        const version: Version = { id: project.currentVersionId, projectId: project.id, parentId: null,
          prompt: '原样套用「' + template.title + '」' + template.versionLabel,
          spec: structuredClone(template.spec), html, note: 'v1 · 模板原版', generationMode: template.generationMode,
          createdAt: now, templateOrigin: origin };
        await deps.store.createProjectFromTemplate(project, version, {
          id: crypto.randomUUID(), projectId: project.id, role: 'system', taskId: null, createdAt: now,
          content: '已从「' + template.title + '」' + template.versionLabel + ' 创建私有副本。作者：' + template.authorName +
            '；许可：MIT。示例源码已独立保存；模板下架或后续发布不会覆盖本项目。' +
            (body.mode === 'copy' ? '当前为原样示例，可继续提出修改需求。' : '参数将在新版本开发完成后生效，v1 保留原始示例。'),
        });
        if (body.mode === 'copy') return h.json({ project: h.projectSummary(project), version: h.versionSummary(version) }, 201);
        try {
          const task = await deps.agent!.submit(project, compiled.prompt, project.spec);
          return h.json({ project: h.projectSummary(project), version: h.versionSummary(version), task }, 202);
        } catch {
          // 副本已创建时返回它，避免客户端以为未创建而重复套用；用户可在工作台重试。
          await deps.store.addMessage({ id: crypto.randomUUID(), projectId: project.id, role: 'user', taskId: null,
            createdAt: new Date().toISOString(), content: compiled.prompt });
          const warning = '私有副本已保存，但修改任务未能入队，请在工作台重试。';
          await deps.store.addMessage({ id: crypto.randomUUID(), projectId: project.id, role: 'system', taskId: null,
            createdAt: new Date().toISOString(), content: warning });
          return h.json({ project: h.projectSummary(project), version: h.versionSummary(version), warning }, 201);
        }
      },
    },
  ];
}
