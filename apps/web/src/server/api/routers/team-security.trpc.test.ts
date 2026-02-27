import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, mockSendTeamInviteEmail, mockCheckTeamMemberLimit } =
  vi.hoisted(() => ({
    mockDb: {
      teamUser: {
        findFirst: vi.fn(),
      },
      user: {
        findUnique: vi.fn(),
      },
      teamInvite: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
      },
    },
    mockSendTeamInviteEmail: vi.fn(),
    mockCheckTeamMemberLimit: vi.fn(),
  }));

vi.mock("~/server/db", () => ({
  db: mockDb,
}));

vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn(),
}));

vi.mock("~/server/mailer", () => ({
  sendMail: vi.fn(),
  sendTeamInviteEmail: mockSendTeamInviteEmail,
}));

vi.mock("~/server/service/webhook-service", () => ({}));

vi.mock("~/server/service/limit-service", () => ({
  LimitService: {
    checkTeamMemberLimit: mockCheckTeamMemberLimit,
  },
}));

vi.mock("~/server/redis", () => ({
  getRedis: () => ({
    get: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
    set: vi.fn(),
  }),
}));

import { createCallerFactory } from "~/server/api/trpc";
import { teamRouter } from "~/server/api/routers/team";

const createCaller = createCallerFactory(teamRouter);

function getContext() {
  return {
    db: mockDb,
    headers: new Headers(),
    session: {
      user: {
        id: 1,
        email: "admin@example.com",
        isWaitlisted: false,
        isAdmin: false,
        isBetaUser: true,
      },
    },
  } as any;
}

describe("teamRouter.resendTeamInvite authorization", () => {
  beforeEach(() => {
    mockDb.teamUser.findFirst.mockReset();
    mockDb.teamInvite.findFirst.mockReset();
    mockSendTeamInviteEmail.mockReset();

    mockDb.teamUser.findFirst.mockResolvedValue({
      teamId: 1,
      userId: 1,
      role: "ADMIN",
      team: { id: 1, name: "Team One" },
    });
  });

  it("does not resend invites that belong to another team", async () => {
    mockDb.teamInvite.findFirst.mockResolvedValue(null);

    const caller = createCaller(getContext());

    await expect(
      caller.resendTeamInvite({ inviteId: "invite_team_2" }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Invite not found",
    });

    expect(mockDb.teamInvite.findFirst).toHaveBeenCalledWith({
      where: {
        teamId: 1,
        id: {
          equals: "invite_team_2",
        },
      },
    });

    expect(mockSendTeamInviteEmail).not.toHaveBeenCalled();
  });
});

describe("teamRouter.createTeamInvite multi-org guards", () => {
  beforeEach(() => {
    mockDb.teamUser.findFirst.mockReset();
    mockDb.user.findUnique.mockReset();
    mockDb.teamInvite.findUnique.mockReset();
    mockDb.teamInvite.create.mockReset();
    mockSendTeamInviteEmail.mockReset();
    mockCheckTeamMemberLimit.mockReset();

    // Default: admin user on team 1
    mockDb.teamUser.findFirst.mockResolvedValue({
      teamId: 1,
      userId: 1,
      role: "ADMIN",
      team: { id: 1, name: "Team One" },
    });

    mockCheckTeamMemberLimit.mockResolvedValue({ isLimitReached: false });
  });

  it("rejects invite when user is already a member of the same team", async () => {
    mockDb.user.findUnique.mockResolvedValue({
      id: 2,
      email: "existing@example.com",
      teamUsers: [{ teamId: 1, userId: 2, role: "MEMBER" }],
    });

    const caller = createCaller(getContext());

    await expect(
      caller.createTeamInvite({
        email: "existing@example.com",
        role: "MEMBER",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "User is already a member of this team",
    });
  });

  it("allows invite when user belongs to a different team", async () => {
    mockDb.user.findUnique.mockResolvedValue({
      id: 2,
      email: "other-team@example.com",
      teamUsers: [],
    });
    mockDb.teamInvite.findUnique.mockResolvedValue(null);
    mockDb.teamInvite.create.mockResolvedValue({
      id: "inv_1",
      teamId: 1,
      email: "other-team@example.com",
      role: "MEMBER",
    });

    const caller = createCaller(getContext());

    await expect(
      caller.createTeamInvite({
        email: "other-team@example.com",
        role: "MEMBER",
      }),
    ).resolves.toMatchObject({
      email: "other-team@example.com",
    });
  });

  it("rejects duplicate pending invite for same team + email", async () => {
    mockDb.user.findUnique.mockResolvedValue(null);
    mockDb.teamInvite.findUnique.mockResolvedValue({
      id: "inv_existing",
      teamId: 1,
      email: "new@example.com",
      role: "MEMBER",
    });

    const caller = createCaller(getContext());

    await expect(
      caller.createTeamInvite({
        email: "new@example.com",
        role: "MEMBER",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "An invite for this email already exists in this team",
    });
  });
});
