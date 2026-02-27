"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@usesend/ui/src/dialog";
import { Button } from "@usesend/ui/src/button";
import { Input } from "@usesend/ui/src/input";
import { Spinner } from "@usesend/ui/src/spinner";
import { toast } from "@usesend/ui/src/toaster";
import { api } from "~/trpc/react";
import { useTeam } from "~/providers/team-context";

export function CreateTeamDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const { switchTeam } = useTeam();
  const createTeam = api.team.createTeam.useMutation();
  const utils = api.useUtils();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    createTeam.mutate(
      { name: name.trim() },
      {
        onSuccess: (team) => {
          if (team) {
            switchTeam(team.id);
            toast.success(`Created organization "${team.name}"`);
          }
          setName("");
          onOpenChange(false);
          utils.team.getTeams.invalidate();
        },
        onError: (error) => {
          toast.error(error.message);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create organization</DialogTitle>
          <DialogDescription>
            Create a new organization to manage separate domains, API keys, and
            campaigns.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            placeholder="Organization name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || createTeam.isPending}
            >
              {createTeam.isPending ? <Spinner className="h-4 w-4" /> : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
