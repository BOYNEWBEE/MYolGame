// 独立测试站点的非密钥配置；只有实验分支使用，不改原 M0 的线上部署。
export const QCA_SITE_ID = '01a1c520-5dac-7ba9-8e24-8ab3690fd479';
export const QCA_SCOPE = 'myolgame.' + QCA_SITE_ID + '.qca-experiment-v1';
export const QCA_DEFAULT_ENABLED = true;
// 创建资源前仍需向目标账号的 Models API 核对，缺失时停止，不自动替换。
export const QCA_DEFAULT_MODEL = 'ultimate';
