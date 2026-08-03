import {
  type Connection,
  Server,
  type WSMessage,
  routePartykitRequest,
} from "partyserver";

import type { ChatMessage, Message } from "../shared";

export class Chat extends Server<Env> {
  static options = { hibernate: true };

  messages = [] as ChatMessage[];

  broadcastMessage(message: Message, exclude?: string[]) {
    this.broadcast(JSON.stringify(message), exclude);
  }

  onStart() {
    // this is where you can initialize things that need to be done before the server starts
    // for example, load previous messages from a database or a service

    try {
      // create the messages table if it doesn't exist
      this.ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, user TEXT, role TEXT, content TEXT)`,
      );

      // load the messages from the database
      this.messages = this.ctx.storage.sql
        .exec(`SELECT * FROM messages`)
        .toArray() as ChatMessage[];
    } catch (err) {
      console.error("onStart: failed to initialize chat storage", err);
      throw err;
    }
  }

  onConnect(connection: Connection) {
    connection.send(
      JSON.stringify({
        type: "all",
        messages: this.messages,
      } satisfies Message),
    );
  }

  saveMessage(message: ChatMessage) {
    // check if the message already exists
    const existingMessage = this.messages.find((m) => m.id === message.id);
    if (existingMessage) {
      this.messages = this.messages.map((m) => {
        if (m.id === message.id) {
          return message;
        }
        return m;
      });
    } else {
      this.messages.push(message);
    }

    try {
      this.ctx.storage.sql.exec(
        `INSERT INTO messages (id, user, role, content) VALUES ('${
          message.id
        }', '${message.user}', '${message.role}', ${JSON.stringify(
          message.content,
        )}) ON CONFLICT (id) DO UPDATE SET content = ${JSON.stringify(
          message.content,
        )}`,
      );
    } catch (err) {
      console.error("saveMessage: failed to persist message", {
        messageId: message.id,
        user: message.user,
        role: message.role,
        error: err,
      });
      throw err;
    }
  }

  onMessage(connection: Connection, message: WSMessage) {
    // let's broadcast the raw message to everyone else
    this.broadcast(message);

    // let's update our local messages store
    let parsed: Message;
    try {
      parsed = JSON.parse(message as string) as Message;
    } catch (err) {
      console.error("onMessage: failed to parse incoming WebSocket message", {
        connectionId: connection.id,
        error: err,
      });
      return;
    }
    if (parsed.type === "add" || parsed.type === "update") {
      this.saveMessage(parsed);
    }
  }
}

export default {
  async fetch(request, env) {
    try {
      return (
        (await routePartykitRequest(request, { ...env })) ||
        env.ASSETS.fetch(request)
      );
    } catch (err) {
      console.error("fetch: unhandled error serving request", {
        method: request.method,
        url: request.url,
        error: err,
      });
      return new Response("Internal Server Error", { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
