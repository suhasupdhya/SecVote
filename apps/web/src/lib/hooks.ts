"use client"

import { useQuery } from "@tanstack/react-query"
import { get } from "./api"
import type { Election, Results } from "./types"

export function useElection(id: string, opts: { admin?: boolean; poll?: number } = {}) {
  return useQuery({
    queryKey: ["election", id, opts.admin ?? false],
    queryFn: () => get<Election>(opts.admin ? `/admin/elections/${id}` : `/elections/${id}`),
    refetchInterval: opts.poll,
  })
}

/** Public results are withheld until declared; officials can ask for a private preview. */
export function useResults(id: string, poll?: number, official = false) {
  return useQuery({
    queryKey: ["results", id, official],
    queryFn: () => get<Results>(official ? `/admin/elections/${id}/results` : `/elections/${id}/results`),
    refetchInterval: poll,
  })
}

export function useTurnout(id: string) {
  return useQuery({
    queryKey: ["turnout", id],
    queryFn: () => get<{ ballots: number; members: number; turnout: number }>(`/elections/${id}/turnout`),
    refetchInterval: 5_000,
  })
}
