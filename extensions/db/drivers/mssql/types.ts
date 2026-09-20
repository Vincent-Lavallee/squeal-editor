/**
 * SQL Server has no single function that renders a column's full type spelling
 * the way Postgres's `format_type` does -- `sys.types.name` alone drops the
 * length/precision/scale a reader needs (`varchar` where the column is
 * `varchar(255)`). This is the one place this driver reassembles a type
 * string from parts rather than asking the engine for its own words, the
 * exception `docs/extension.md` documents alongside `format_type` and
 * `COLUMN_TYPE`.
 */
export function renderColumnType(args: {
    typeName: string;
    maxLength: number;
    precision: number;
    scale: number;
}): string {
    const { typeName, maxLength, precision, scale } = args;
    const name = typeName.toLowerCase();

    if (name === 'decimal' || name === 'numeric') return `${name}(${precision},${scale})`;
    if (name === 'datetime2' || name === 'datetimeoffset' || name === 'time')
        return `${name}(${scale})`;
    if (name === 'varchar' || name === 'char' || name === 'varbinary' || name === 'binary')
        return maxLength === -1 ? `${name}(max)` : `${name}(${maxLength})`;
    // nvarchar/nchar store UTF-16, so `max_length` is bytes -- half of it is characters.
    if (name === 'nvarchar' || name === 'nchar')
        return maxLength === -1 ? `${name}(max)` : `${name}(${maxLength / 2})`;
    return name;
}
