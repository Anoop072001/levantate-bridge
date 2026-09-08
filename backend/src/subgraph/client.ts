import { requireEnv } from "../env.js";

interface GraphqlResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export async function querySubgraph<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const url = requireEnv("SUBGRAPH_QUERY_URL");
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Subgraph query failed: HTTP ${res.status}`);
  }

  const body = (await res.json()) as GraphqlResponse<T>;
  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join("; "));
  }
  if (!body.data) {
    throw new Error("Subgraph returned no data");
  }
  return body.data;
}
