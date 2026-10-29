/** CTE visibility for owned reporting SQL; strings/comments are already single tokens. */
export function cteScopes(
  tokens: readonly string[],
  next: (index: number) => number,
  name: (token: string) => string,
) {
  const closing = new Map<number, number>();
  const stack: number[] = [];
  for (const [index, token] of tokens.entries()) {
    if (token === "(") stack.push(index);
    if (token === ")") {
      const open = stack.pop();
      if (open !== undefined) closing.set(open, index);
    }
  }
  const scopes: { name: string; start: number; end: number }[] = [];
  for (const [index, token] of tokens.entries()) {
    if (!/^WITH$/i.test(token)) continue;
    let end = tokens.length;
    for (const [open, close] of closing)
      if (open < index && close > index && close < end) end = close;
    let cursor = next(index + 1);
    const recursive = /^RECURSIVE$/i.test(tokens[cursor] ?? "");
    if (recursive) cursor = next(cursor + 1);
    while (cursor < end) {
      const identifier = tokens[cursor];
      if (!/^(?:"(?:""|[^"])+"|[A-Za-z_][A-Za-z_0-9]*)$/.test(identifier ?? ""))
        break;
      let body = next(cursor + 1);
      // Optional CTE column names precede AS.
      if (tokens[body] === "(") body = next((closing.get(body) ?? end) + 1);
      if (!/^AS$/i.test(tokens[body] ?? "")) break;
      body = next(body + 1);
      if (/^NOT$/i.test(tokens[body] ?? "")) body = next(body + 1);
      if (/^MATERIALIZED$/i.test(tokens[body] ?? "")) body = next(body + 1);
      const close = closing.get(body);
      if (tokens[body] !== "(" || close === undefined) break;
      scopes.push({
        name: name(identifier),
        start: recursive ? index : close + 1,
        end,
      });
      cursor = next(close + 1);
      if (tokens[cursor] !== ",") break;
      cursor = next(cursor + 1);
    }
  }
  return scopes;
}
