# 03 Data Model

## Tables

### `mcp_servers`

Stores user-created MCP server definitions.

- `id`: string primary key
- `name`: display name
- `transport`: `stdio` or `streamable_http`
- `command`: stdio command
- `args_json`: JSON array for stdio args
- `url`: streamable HTTP URL
- `headers_json`: JSON object for HTTP headers
- `env_json`: JSON object for stdio environment
- `created_at`: ISO timestamp
- `updated_at`: ISO timestamp

Secrets are stored locally for MVP but must be redacted from API responses.

### `mcp_scans`

Stores one scan summary.

- `id`
- `server_id`
- `token_profile`
- `scanned_at`
- `status`
- `total_tools`
- `total_tokens`
- `total_raw_bytes`
- `average_tokens_per_tool`
- `largest_tool_name`
- `largest_tool_tokens`
- `error_message`

### `mcp_tool_scans`

Stores normalized tool-level scan output.

- `id`
- `scan_id`
- `tool_name`
- `description`
- `input_schema_json`
- `annotations_json`
- `raw_tool_json`
- `total_tokens`
- `name_tokens`
- `description_tokens`
- `schema_tokens`
- `annotations_tokens`
- `raw_bytes`
- `contribution_percent`

### `scan_events`

Stores scan timeline and errors.

- `id`
- `scan_id`
- `level`
- `message`
- `created_at`

## Indexes

- `mcp_scans(server_id, scanned_at)`
- `mcp_tool_scans(scan_id, total_tokens)`
- `scan_events(scan_id, created_at)`
