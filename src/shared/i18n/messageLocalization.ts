type Catalogs = Record<string, Record<string, string>>;
type Values = Record<string, unknown>;
type Lookup = (key: string, values?: Values) => string;
const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function createMessageTranslator(catalogs: Catalogs, lookup: Lookup): Lookup {
  const dictionaries = Object.values(catalogs);
  const keys = new Set(dictionaries.flatMap(dictionary => Object.keys(dictionary)));
  const reverse = new Map(dictionaries.flatMap(dictionary => Object.entries(dictionary).map(([key, value]) => [value, key] as const)));
  const patterns: { key: string; names: string[]; expression: RegExp; fixedLength: number }[] = [];
  for (const key of keys) for (const template of new Set([key, ...dictionaries.map(dictionary => dictionary[key])])) {
    if (!template) continue;
    const names: string[] = [];
    let start = 0, expression = '', fixedLength = 0;
    for (const match of template.matchAll(/\{\{\s*([\w]+)\s*\}\}/g)) {
      const fixed = template.slice(start, match.index);
      expression += escapePattern(fixed) + '([\\s\\S]+?)';
      fixedLength += fixed.length;
      names.push(match[1]); start = match.index! + match[0].length;
    }
    if (!names.length) continue;
    const tail = template.slice(start);
    fixedLength += tail.length;
    // A template consisting only of a placeholder would match every user value.
    if (!fixedLength) continue;
    patterns.push({ key, names, expression: new RegExp('^' + expression + escapePattern(tail) + '$'), fixedLength });
  }
  patterns.sort((a, b) => b.fixedLength - a.fixedLength);

  function translate(message: string, values?: Values, depth = 0): string {
    if (values !== undefined) return lookup(message, values);
    if (!message || message.length > 4096 || depth >= 8) return message;
    if (keys.has(message)) return lookup(message);
    const source = reverse.get(message);
    if (source) return lookup(source);
    for (const pattern of patterns) {
      const match = pattern.expression.exec(message);
      if (!match) continue;
      const parsed: Values = {};
      let valid = true;
      pattern.names.forEach((name, index) => {
        const value = match[index + 1];
        if (!value.trim() || Object.hasOwn(parsed, name) && parsed[name] !== value) valid = false;
        parsed[name] = value;
      });
      if (!valid) continue;
      for (const name of ['label', 'message', 'reason']) if (typeof parsed[name] === 'string') parsed[name] = translate(parsed[name] as string, undefined, depth + 1);
      return lookup(pattern.key, parsed);
    }
    return message;
  }
  return translate;
}
