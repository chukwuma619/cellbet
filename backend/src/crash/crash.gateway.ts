import { forwardRef, Inject } from "@nestjs/common";
import {
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";

import { CrashService } from "./crash.service";

@WebSocketGateway({
  namespace: "/crash",
  cors: {
    origin: true,
    credentials: true,
  },
})
export class CrashGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  constructor(
    @Inject(forwardRef(() => CrashService))
    private readonly crashService: CrashService,
  ) {}

  async handleConnection(client: Socket) {
    const snap = await this.crashService.getPublicSnapshotAsync();
    client.emit("crash:state", snap);
  }

  @SubscribeMessage("crash:get_state")
  async getState() {
    return this.crashService.getPublicSnapshotAsync();
  }

  @SubscribeMessage("crash:ping")
  ping(@MessageBody() body: { t?: number }) {
    return { t: body?.t, pong: Date.now() };
  }

  emitPhase(payload: unknown) {
    this.server.emit("crash:phase", payload);
  }

  emitTick(payload: unknown) {
    this.server.emit("crash:tick", payload);
  }

  emitCrashed(payload: unknown) {
    this.server.emit("crash:crashed", payload);
  }

  emitSettled(payload: unknown) {
    this.server.emit("crash:settled", payload);
  }

  emitBetPlaced(payload: unknown) {
    this.server.emit("crash:bet_placed", payload);
  }

  emitCashOut(payload: unknown) {
    this.server.emit("crash:cash_out", payload);
  }

  emitState(payload: unknown) {
    this.server.emit("crash:state", payload);
  }
}
