import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    teamUser: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("~/server/db", () => ({
  db: mockDb,
}));

vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn(),
}));

import {
  authedProcedure,
  createCallerFactory,
  createTRPCRouter,
  protectedProcedure,
  teamAdminProcedure,
  teamProcedure,
} from "~/server/api/trpc";

const testRouter = createTRPCRouter({
  authedPing: authedProcedure.query(({ ctx }) => ({
    userId: ctx.session.user.id,
  })),
  protectedPing: protectedProcedure.query(({ ctx }) => ({
    userId: ctx.session.user.id,
  })),
  teamPing: teamProcedure.query(({ ctx }) => ({ teamId: ctx.team.id })),
  teamAdminPing: teamAdminProcedure.query(({ ctx }) => ({
    role: ctx.teamUser.role,
  })),
});

const createCaller = createCallerFactory(testRouter);

function getContext(
  session: Record<string, unknown> | null,
  extraHeaders?: Record<string, string>,
) {
  const headers = new Headers();
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      headers.set(k, v);
    }
  }
  return {
    db: mockDb,
    session,
    headers,
  } as any;
}

const baseUser = {
  id: 1,
  isBetaUser: true,
  isAdmin: false,
  isWaitlisted: false,
  email: "user@example.com",
};

describe("tRPC middleware procedures", () => {
  beforeEach(() => {
    mockDb.teamUser.findFirst.mockReset();
  });

  it("blocks authed procedure without session", async () => {
    const caller = createCaller(getContext(null));
    await expect(caller.authedPing()).rejects.toBeInstanceOf(TRPCError);
    await expect(caller.authedPing()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("blocks protected procedure for waitlisted users", async () => {
    const caller = createCaller(
      getContext({
        user: { ...baseUser, isWaitlisted: true },
      }),
    );

    await expect(caller.protectedPing()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("loads team context for team procedure", async () => {
    mockDb.teamUser.findFirst.mockResolvedValue({
      teamId: 10,
      userId: 1,
      role: "ADMIN",
      team: { id: 10, name: "Acme" },
    });

    const caller = createCaller(
      getContext({
        user: baseUser,
      }),
    );

    await expect(caller.teamPing()).resolves.toEqual({ teamId: 10 });
  });

  it("blocks team admin procedure for non-admin team users", async () => {
    mockDb.teamUser.findFirst.mockResolvedValue({
      teamId: 10,
      userId: 1,
      role: "MEMBER",
      team: { id: 10, name: "Acme" },
    });

    const caller = createCaller(
      getContext({
        user: baseUser,
      }),
    );

    await expect(caller.teamAdminPing()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("fails team procedure when user has no team", async () => {
    mockDb.teamUser.findFirst.mockResolvedValue(null);

    const caller = createCaller(
      getContext({
        user: baseUser,
      }),
    );

    await expect(caller.teamPing()).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  describe("x-team-id header handling", () => {
    it.each(["abc", "1abc", "0", "-1", "3.5"])(
      "rejects malformed x-team-id value '%s'",
      async (badValue) => {
        const caller = createCaller(
          getContext(
            { user: baseUser },
            { "x-team-id": badValue },
          ),
        );

        await expect(caller.teamPing()).rejects.toMatchObject({
          code: "BAD_REQUEST",
          message: "Invalid x-team-id header",
        });
        expect(mockDb.teamUser.findFirst).not.toHaveBeenCalled();
      },
    );

    it("filters by teamId when valid x-team-id is provided", async () => {
      mockDb.teamUser.findFirst.mockResolvedValue({
        teamId: 42,
        userId: 1,
        role: "ADMIN",
        team: { id: 42, name: "Team B" },
      });

      const caller = createCaller(
        getContext(
          { user: baseUser },
          { "x-team-id": "42" },
        ),
      );

      await expect(caller.teamPing()).resolves.toEqual({ teamId: 42 });
      expect(mockDb.teamUser.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 1, teamId: 42 },
        }),
      );
    });

    it("falls back to findFirst without teamId filter when header is absent", async () => {
      mockDb.teamUser.findFirst.mockResolvedValue({
        teamId: 10,
        userId: 1,
        role: "ADMIN",
        team: { id: 10, name: "Acme" },
      });

      const caller = createCaller(
        getContext({ user: baseUser }),
      );

      await expect(caller.teamPing()).resolves.toEqual({ teamId: 10 });
      expect(mockDb.teamUser.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 1 },
        }),
      );
    });

    it("uses deterministic ordering (teamId asc) for fallback", async () => {
      mockDb.teamUser.findFirst.mockResolvedValue({
        teamId: 5,
        userId: 1,
        role: "MEMBER",
        team: { id: 5, name: "First" },
      });

      const caller = createCaller(
        getContext({ user: baseUser }),
      );

      await caller.teamPing();
      expect(mockDb.teamUser.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { teamId: "asc" },
        }),
      );
    });
  });
});
