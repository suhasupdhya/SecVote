"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { useFieldArray, useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { CalendarRange, FilePlus2, FileText, Layers, Pencil, Plus, Save, Settings2, Trash2 } from "lucide-react"
import { post, put } from "@/lib/api"
import type { Election } from "@/lib/types"
import { Alert, Avatar, Badge, Button, Card, CheckRow, Field, Input, Select, Textarea } from "@/components/ui"

const schema = z
  .object({
    title: z.string().min(3, "At least 3 characters"),
    org: z.string().min(2, "At least 2 characters"),
    description: z.string().max(5000),
    allow_nota: z.boolean(),
    mode: z.enum(["open", "sealed"]),
    high_stakes: z.boolean(),
    reg_start: z.string().min(1),
    reg_end: z.string().min(1),
    vote_start: z.string().min(1),
    vote_end: z.string().min(1),
    races: z
      .array(
        z.object({
          title: z.string().min(1, "Required"),
          method: z.enum(["plurality", "irv"]),
          candidates: z.string().min(1, "Add at least one candidate"),
          manifestos: z.record(z.string(), z.string().max(2000, "Keep it under 2000 characters")),
        }),
      )
      .min(1)
      .max(32),
  })
  // One specific message per broken rule, shown on the field that needs changing.
  .superRefine((v, ctx) => {
    if (v.reg_end <= v.reg_start)
      ctx.addIssue({ code: "custom", path: ["reg_end"], message: "Must be after registration opens" })
    if (v.vote_start < v.reg_end)
      ctx.addIssue({
        code: "custom",
        path: ["vote_start"],
        message: "Voting can't open before registration closes (the voter roll is locked at that moment)",
      })
    if (v.vote_end <= v.vote_start)
      ctx.addIssue({ code: "custom", path: ["vote_end"], message: "Must be after voting opens" })
  })
type FormValues = z.infer<typeof schema>

const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
const inHours = (h: number) => local(new Date(Date.now() + h * 3_600_000))

function Section({ n, title, icon: I, children }: { n: number; title: string; icon: typeof Layers; children: React.ReactNode }) {
  return (
    <div className="grid gap-5 border-t border-line pt-6 first:border-0 first:pt-0 lg:grid-cols-[13rem_1fr]">
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-xs font-bold text-brand">{n}</span>
        <div>
          <p className="flex items-center gap-1.5 font-semibold">
            <I className="size-4 text-muted" aria-hidden /> {title}
          </p>
        </div>
      </div>
      <div>{children}</div>
    </div>
  )
}

type Form = ReturnType<typeof useForm<FormValues>>

/** Each candidate typed above, with an optional manifesto voters read on the election page. */
function CandidateDetails({ control, index, setValue }: { control: Form["control"]; index: number; setValue: Form["setValue"] }) {
  const text = useWatch({ control, name: `races.${index}.candidates` }) ?? ""
  const manifestos = useWatch({ control, name: `races.${index}.manifestos` }) ?? {}
  const [open, setOpen] = useState<string | null>(null)
  const names = [...new Set(text.split("\n").map((s) => s.trim()).filter(Boolean))]
  if (!names.length) return null
  const save = (name: string, value: string) => setValue(`races.${index}.manifestos`, { ...manifestos, [name]: value }, { shouldDirty: true })
  return (
    <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
      {names.map((n) => {
        const has = !!manifestos[n]?.trim()
        return (
          <li key={n} className="px-3 py-2.5">
            <div className="flex items-center gap-2.5">
              <Avatar name={n} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{n}</span>
              <Button type="button" variant="ghost" size="sm" icon={has ? Pencil : Plus} onClick={() => setOpen(open === n ? null : n)}>
                {has ? "Edit manifesto" : "Add manifesto"}
              </Button>
            </div>
            {open === n ? (
              <Textarea
                aria-label={`Manifesto for ${n}`}
                className="mt-2"
                rows={3}
                maxLength={2000}
                placeholder="A few lines on what this candidate stands for (optional)"
                value={manifestos[n] ?? ""}
                onChange={(e) => save(n, e.target.value)}
              />
            ) : (
              has && <p className="mt-1 line-clamp-2 pl-10 text-xs text-muted">{manifestos[n]}</p>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** Form values for an existing draft, so it can be edited instead of deleted and re-created. */
function valuesFrom(e: Election): FormValues {
  return {
    title: e.title,
    org: e.org,
    description: e.description,
    allow_nota: e.allow_nota,
    mode: e.mode,
    high_stakes: e.high_stakes,
    reg_start: local(new Date(e.reg_start)),
    reg_end: local(new Date(e.reg_end)),
    vote_start: local(new Date(e.vote_start)),
    vote_end: local(new Date(e.vote_end)),
    races: e.races.map((r) => ({
      title: r.title,
      method: r.method === "irv" ? "irv" : "plurality",
      candidates: r.candidates.map((c) => c.name).join("\n"),
      manifestos: Object.fromEntries(r.candidates.filter((c) => c.manifesto).map((c) => [c.name, c.manifesto])),
    })),
  }
}

/** Creates a new draft, or edits `initial` (a draft that was never published). */
export function CreateElection({ initial }: { initial?: Election }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const { register, control, handleSubmit, formState, setValue } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: initial
      ? valuesFrom(initial)
      : {
          title: "",
          org: "",
          description: "",
          allow_nota: true,
          mode: "open",
          high_stakes: false,
          reg_start: inHours(0),
          reg_end: inHours(24),
          vote_start: inHours(25),
          vote_end: inHours(49),
          races: [{ title: "President", method: "plurality", candidates: "", manifestos: {} }],
        },
  })
  const races = useFieldArray({ control, name: "races" })
  const mode = useWatch({ control, name: "mode" })
  const errs = formState.errors

  async function onSubmit(v: FormValues) {
    setError(null)
    try {
      const body = {
        ...v,
        reg_start: new Date(v.reg_start).toISOString(),
        reg_end: new Date(v.reg_end).toISOString(),
        vote_start: new Date(v.vote_start).toISOString(),
        vote_end: new Date(v.vote_end).toISOString(),
        races: v.races.map((r) => ({
          title: r.title,
          method: v.mode === "sealed" ? r.method : "plurality",
          candidates: r.candidates
            .split("\n")
            .map((n) => n.trim())
            .filter(Boolean)
            .map((name) => ({ name, manifesto: (r.manifestos[name] ?? "").trim() })),
        })),
      }
      const e = initial ? await put<Election>(`/admin/elections/${initial.id}`, body) : await post<Election>("/admin/elections", body)
      router.push(`/admin/elections/${e.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : initial ? "Could not save changes" : "Could not create election")
    }
  }

  return (
    <div>
      <Card
        title="Election details"
        icon={FilePlus2}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <Section n={1} title="Details" icon={FileText}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="title" label="Title" error={errs.title?.message}>
                <Input id="title" placeholder="Student Council 2026" {...register("title")} />
              </Field>
              <Field id="org" label="Organisation" error={errs.org?.message}>
                <Input id="org" placeholder="Example College" {...register("org")} />
              </Field>
              <Field id="description" label="Description" className="sm:col-span-2">
                <Textarea id="description" rows={2} placeholder="What is this election for?" {...register("description")} />
              </Field>
            </div>
          </Section>

          <Section n={2} title="Schedule" icon={CalendarRange}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="reg_start" label="Registration opens">
                <Input id="reg_start" type="datetime-local" {...register("reg_start")} />
              </Field>
              <Field id="reg_end" label="Registration closes" error={errs.reg_end?.message}>
                <Input id="reg_end" type="datetime-local" {...register("reg_end")} />
              </Field>
              <Field id="vote_start" label="Voting opens" error={errs.vote_start?.message}>
                <Input id="vote_start" type="datetime-local" {...register("vote_start")} />
              </Field>
              <Field id="vote_end" label="Voting closes" error={errs.vote_end?.message}>
                <Input id="vote_end" type="datetime-local" {...register("vote_end")} />
              </Field>
            </div>
            <p className="mt-3 text-xs text-muted">The voter roll is frozen on chain automatically when registration closes.</p>
          </Section>

          <Section n={3} title="Ballot rules" icon={Settings2}>
            <fieldset className="mb-4">
              <legend className="mb-2 text-sm font-medium text-ink-2">Ballot type</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  {
                    v: "open",
                    t: "Open ballot",
                    d: "Counted on chain as votes arrive. Results stay hidden in SecVote until you declare them.",
                  },
                  {
                    v: "sealed",
                    t: "Sealed ballot (recommended)",
                    d: "Encrypted in each voter's browser. Nobody can count until 2 of 3 trustees unlock it after voting. Supports ranked choice.",
                  },
                ].map((o) => (
                  <label
                    key={o.v}
                    className="flex cursor-pointer gap-3 rounded-xl border border-line bg-subtle/60 p-3.5 text-sm transition hover:border-line-strong has-[:checked]:border-brand has-[:checked]:bg-brand-50"
                  >
                    <input type="radio" value={o.v} {...register("mode")} className="mt-0.5 size-4 accent-[var(--color-brand)]" />
                    <span>
                      <span className="font-semibold text-ink">{o.t}</span>
                      <span className="block text-xs text-muted">{o.d}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
              <CheckRow {...register("allow_nota")}>
                <span className="font-semibold text-ink">Allow NOTA</span>
                <span className="block text-xs text-muted">Voters can choose &ldquo;None of the above&rdquo;.</span>
              </CheckRow>
            </div>
            <p className="mt-3 text-xs text-muted">
              Each voter is approved by one election official.
              {mode === "sealed" && " After saving, add three trustees and run the key ceremony before publishing."}
            </p>
          </Section>

          <Section n={4} title="Posts and candidates" icon={Layers}>
            <div className="space-y-4">
              {races.fields.map((f, i) => (
                <div key={f.id} className="space-y-3 rounded-xl border border-line bg-subtle/40 p-4">
                  <div className="flex items-center justify-between">
                    <Badge tone="brand">Post {i + 1}</Badge>
                    <Button type="button" variant="ghost" size="sm" icon={Trash2} onClick={() => races.remove(i)} disabled={races.fields.length === 1}>
                      Remove
                    </Button>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-[1fr_1.5fr]">
                    <Field id={`race-${i}`} label="Post title" error={errs.races?.[i]?.title?.message}>
                      <Input id={`race-${i}`} placeholder="e.g. Secretary" {...register(`races.${i}.title`)} />
                    </Field>
                    <Field id={`cands-${i}`} label="Candidates (one per line)" error={errs.races?.[i]?.candidates?.message}>
                      <Textarea id={`cands-${i}`} rows={3} placeholder={"Asha\nBala"} {...register(`races.${i}.candidates`)} />
                    </Field>
                  </div>
                  {mode === "sealed" && (
                    <Field id={`method-${i}`} label="Counting">
                      <Select id={`method-${i}`} {...register(`races.${i}.method`)}>
                        <option value="plurality">Pick one (most votes wins)</option>
                        <option value="irv">Ranked choice (instant runoff)</option>
                      </Select>
                    </Field>
                  )}
                  <CandidateDetails control={control} index={i} setValue={setValue} />
                </div>
              ))}
              <Button type="button" variant="soft" icon={Plus} onClick={() => races.append({ title: "", method: "plurality", candidates: "", manifestos: {} })}>
                Add post
              </Button>
            </div>
          </Section>

          {initial?.mode === "sealed" && initial.chain.public_key && (
            <Alert tone="warn">Saving changes resets the trustee key ceremony. The trustees will need to run it again before you publish.</Alert>
          )}
          {error && <Alert tone="bad">{error}</Alert>}
          <div className="flex justify-end border-t border-line pt-6">
            <Button type="submit" busy={formState.isSubmitting} size="lg" icon={Save}>
              {initial ? "Save changes" : "Save draft"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}

