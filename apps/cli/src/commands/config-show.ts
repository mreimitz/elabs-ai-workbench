import { MCPFP_CONFIG_FILE_NAME } from "@mcp-token-footprint/shared";
import { describeTokenPrefix, tokenSourceLabel } from "../config.js";
import { renderFields } from "../output.js";
import { type CommandContext, emitJson } from "./context.js";

/**
 * `mcpfp config show` — "which instance am I actually talking to, and with what?". The first thing
 * anyone runs when a CI job hits an unexpected 401.
 *
 * **It renders the token's display prefix and never the token.** The JSON form has no field that
 * could hold the plaintext: `token` is a small object of *facts about* the credential — is there
 * one, what does its prefix look like, where did it come from — and that is the whole shape.
 */
export async function runConfigShowCommand(context: CommandContext): Promise<void> {
  const { config } = context;
  const token =
    config.token === undefined || config.tokenSource === undefined
      ? null
      : {
          present: true as const,
          displayPrefix: describeTokenPrefix(config.token),
          source: config.tokenSource,
        };

  if (context.format === "json") {
    await emitJson(context, {
      apiUrl: config.apiUrl,
      timeoutMs: config.timeoutMs,
      configFile: config.configPath ?? null,
      token,
    });
    return;
  }

  await context.emitter.payload(
    renderFields([
      ["API URL", config.apiUrl],
      ["Timeout", `${config.timeoutMs} ms`],
      ["Config file", config.configPath ?? `none found (looked for ${MCPFP_CONFIG_FILE_NAME})`],
      [
        "Token",
        token === null
          ? "none — loopback instances are open unless API_AUTH_REQUIRED=true"
          : `${token.displayPrefix} (${tokenSourceLabel(token.source, config.configPath)})`,
      ],
    ]),
  );
}
