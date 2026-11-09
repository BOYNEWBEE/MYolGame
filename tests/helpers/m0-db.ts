// 只用于测试的 SDK 契约替身；每次执行模拟数据库原子的唯一插入和条件更新。
import type { DatabaseClient } from '../../functions/store_supabase.ts';
type Row = Record<string, any>;
export class M0TestDatabase implements DatabaseClient {
  tables = new Map<string, Row[]>();
  failAfterNextInsert = '';
  snapshot() { return structuredClone([...this.tables.entries()]); }
  constructor(snapshot?: [string, Row[]][]) { if (snapshot) this.tables = new Map(structuredClone(snapshot)); }
  from(table: string): any {
    if (!this.tables.has(table)) this.tables.set(table, []);
    const tableRows = this.tables.get(table)!;
    let predicates: ((row: Row) => boolean)[] = [];
    let operation = 'read', value: Row = {}, conflict = 'id', maximum = Infinity;
    let ordering: { field: string; ascending: boolean } | undefined;
    let columns = '*'; let single = false;
    const query: any = {
      select(fields = '*') { columns = fields; return query; },
      eq(field: string, wanted: unknown) { predicates.push(row => row[field] === wanted); return query; },
      insert(row: Row) { operation = 'insert'; value = row; return query; },
      insertIfAbsent(row: Row, options: { onConflict: string }) { operation = 'insert-if-absent'; value = row; conflict = options.onConflict; return query; },
      update(row: Row) { operation = 'update'; value = row; return query; },
      order(field: string, options: { ascending: boolean }) { ordering = { field, ascending: options.ascending }; return query; },
      limit(n: number) { maximum = n; return query; },
      single() { single = true; return query; },
      then: (resolve: (result: any) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(() => {
        let result: Row[];
        if (operation.startsWith('insert')) {
          const duplicate = tableRows.some(row => row[conflict] === value[conflict]);
          if (duplicate && operation === 'insert-if-absent') result = [];
          else if (duplicate) return { error: { code: 'duplicate' }, data: null };
          else {
            const row = structuredClone(value); tableRows.push(row); result = [row];
            if (this.failAfterNextInsert === table) { this.failAfterNextInsert = ''; throw new Error('模拟响应丢失'); }
          }
        } else {
          result = tableRows.filter(row => predicates.every(p => p(row)));
          if (ordering) { const { field, ascending } = ordering; result.sort((a, b) => (a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0) * (ascending ? 1 : -1)); }
          result = result.slice(0, maximum);
          if (operation === 'update') for (const row of result) Object.assign(row, structuredClone(value));
        }
        const projected = result.map(row => columns === '*' ? row : Object.fromEntries(columns.split(',').map(field => [field, row[field]])));
        return { data: structuredClone(single ? projected[0] ?? null : projected), error: null };
      }).then(resolve, reject),
    };
    return query;
  }
}
