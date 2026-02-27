"use client";

import { createContext, useContext, useMemo, useCallback } from "react";
import { api } from "~/trpc/react";

const TEAM_COOKIE = "usesend-team-id";

function getTeamIdCookie(): number | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${TEAM_COOKIE}=([1-9]\\d*)`),
  );
  return match ? Number(match[1]) : null;
}

function setTeamIdCookie(teamId: number) {
  document.cookie = `${TEAM_COOKIE}=${teamId};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
}

// Define the Team type based on the Prisma schema
type Team = {
  id: number;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  plan: "FREE" | "BASIC";
  stripeCustomerId?: string | null;
  billingEmail?: string | null;
};

type TeamWithRole = Team & {
  teamUsers: { role: "ADMIN" | "MEMBER" }[];
};

interface TeamContextType {
  currentTeam: Team | null;
  teams: TeamWithRole[];
  isLoading: boolean;
  currentRole: "ADMIN" | "MEMBER";
  currentIsAdmin: boolean;
  switchTeam: (teamId: number) => void;
}

const TeamContext = createContext<TeamContextType | undefined>(undefined);

export function TeamProvider({ children }: { children: React.ReactNode }) {
  const { data: teams, status } = api.team.getTeams.useQuery();
  const utils = api.useUtils();

  const currentTeam = useMemo(() => {
    if (!teams || teams.length === 0) return null;
    const savedId = getTeamIdCookie();
    const found = savedId ? teams.find((t) => t.id === savedId) : null;
    const selected = found ?? teams[0]!;
    // Sync cookie if it was missing or pointed at a stale team
    if (typeof document !== "undefined" && selected.id !== savedId) {
      setTeamIdCookie(selected.id);
    }
    return selected;
  }, [teams]);

  const currentRole = currentTeam?.teamUsers[0]?.role ?? "MEMBER";

  const switchTeam = useCallback(
    (teamId: number) => {
      setTeamIdCookie(teamId);
      utils.invalidate();
    },
    [utils],
  );

  const value = useMemo(
    () => ({
      currentTeam,
      teams: (teams as TeamWithRole[]) || [],
      isLoading: status === "pending",
      currentRole,
      currentIsAdmin: currentRole === "ADMIN",
      switchTeam,
    }),
    [currentTeam, teams, status, currentRole, switchTeam],
  );

  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>;
}

export function useTeam() {
  const context = useContext(TeamContext);
  if (context === undefined) {
    throw new Error("useTeam must be used within a TeamProvider");
  }
  return context;
}
