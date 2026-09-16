import { handleApiRequest, type ApiProxyEnv } from "../../shared/api-proxy";

export const onRequest: PagesFunction<ApiProxyEnv> = (ctx) =>
  handleApiRequest(ctx.request, ctx.env);
