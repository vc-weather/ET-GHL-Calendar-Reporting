import syncHandler from "./sync-ghl-calendar-calls.mjs";

export default async function handler(request, response) {
  request.query = {
    ...request.query,
    daysBack: request.query?.daysBack ?? "7",
    daysForward: request.query?.daysForward ?? "1",
  };

  return syncHandler(request, response);
}
