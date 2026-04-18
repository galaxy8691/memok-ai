/**
 * Runtime module is provided by the OpenClaw gateway (`node_modules/openclaw`).
 * We do not list `openclaw` in package.json so local `npm install` stays small;
 * this stub is only for TypeScript resolution and intentionally loose typing.
 */
declare module "openclaw/plugin-sdk/plugin-entry" {
  export function definePluginEntry(entry: unknown): unknown;
}
