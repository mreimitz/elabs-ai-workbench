# Export column spec

The analyzer expects a header row followed by one record per line.

| column | type   | notes                         |
| ------ | ------ | ----------------------------- |
| id     | string | unique per record             |
| value  | number | non-negative                  |
| ts     | string | ISO-8601 timestamp            |

Anything outside these three columns is ignored.
