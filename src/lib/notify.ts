import "server-only";
import { config } from "./config";

/** Posts a message to the league group chat (Discord and/or GroupMe). */
export async function notify(text: string): Promise<{ sent: string[] }> {
  const sent: string[] = [];
  const jobs: Promise<void>[] = [];

  if (config.discordWebhook) {
    jobs.push(
      fetch(config.discordWebhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: text.slice(0, 1990), allowed_mentions: { parse: [] } }),
      }).then((r) => {
        if (!r.ok) throw new Error(`Discord returned ${r.status}`);
        sent.push("discord");
      }),
    );
  }

  if (config.groupmeBotId) {
    // GroupMe caps a message at 1000 characters.
    jobs.push(
      fetch("https://api.groupme.com/v3/bots/post", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bot_id: config.groupmeBotId, text: text.slice(0, 1000) }),
      }).then((r) => {
        if (!r.ok) throw new Error(`GroupMe returned ${r.status}`);
        sent.push("groupme");
      }),
    );
  }

  const results = await Promise.allSettled(jobs);
  const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  if (failed.length && !sent.length) throw new Error(failed.map((f) => String(f.reason)).join("; "));
  return { sent };
}
