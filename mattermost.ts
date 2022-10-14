import { space } from "$sb/silverbullet-syscall/mod.ts";
import * as YAML from "yaml";
import { readYamlPage } from "$sb/lib/yaml_page.ts";
import { readSecrets } from "$sb/lib/secrets_page.ts";
import {
  channelId,
  mmUrl,
  setGroupId,
  userMappingCachePage,
} from "./constants.ts";

async function writeYamlPage(pageName: string, data: any): Promise<void> {
  const text = YAML.stringify(data);
  await space.writePage(pageName, "```yaml\n" + text + "\n```");
}
let mappingCache: any;

async function readMappings() {
  if (!mappingCache) {
    mappingCache = await readYamlPage(userMappingCachePage);
  }
}

async function writeMappings() {
  await writeYamlPage(userMappingCachePage, mappingCache);
}
export type MattermostUser = {
  id: string;
  username: string;
};

async function mattermostFetch(
  path: string,
  method: string,
  body?: any,
): Promise<any> {
  const [mmToken] = await readSecrets(["setMattermostToken"]);
  let url = `${mmUrl}${path}`;
  let headers = {
    Authorization: `Bearer ${mmToken}`,
    "Content-Type": "application/json",
  };
  let r = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status < 200 && r.status >= 300) {
    throw new Error(`${r.status} ${await r.text()}`);
  }
  return await r.json();
}

export async function findUserByName(name: string): Promise<MattermostUser> {
  await readMappings();
  if (mappingCache[name]) {
    return mappingCache[name];
  }
  let users = (
    await mattermostFetch(
      `/api/v4/users/autocomplete?name=${encodeURIComponent(name)}`,
      "GET",
    )
  ).users;
  if (users.length === 0) {
    throw new Error(`No matching user found: ${name}`);
  }
  if (users.length > 1) {
    console.warn(
      "Multiple users found",
      users.map((user: any) => user.username),
    );
  }
  const user = { id: users[0].id, username: users[0].username };
  mappingCache[name] = user;
  await writeMappings();
  return user;
}
export function postMessage(message: string) {
  return mattermostFetch(`/api/v4/posts`, "POST", {
    channel_id: channelId,
    message,
  });
}
export function updateChannel(id: string, props: any) {
  return mattermostFetch(`/api/v4/channels/${id}/patch`, "PUT", {
    id,
    ...props,
  });
}
export async function resetSETTeam(userIds: string[]) {
  console.log("Assigning new userIds", userIds);
  const currentMembers = await mattermostFetch(
    `/api/v4/users?in_group=${setGroupId}&per_page=50`,
    "GET",
  );

  await mattermostFetch(`/api/v4/groups/${setGroupId}/members`, "DELETE", {
    user_ids: currentMembers.map((user: any) => user.id),
  });

  console.log("Cleared @set");

  await mattermostFetch(`/api/v4/groups/${setGroupId}/members`, "POST", {
    user_ids: userIds,
  });
  console.log("Set up new @set members");
}
