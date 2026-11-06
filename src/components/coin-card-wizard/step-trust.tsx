"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { saveCoinCardSection } from "@/app/actions/coin-card";
import { Field, inputCls, labelCls, btnCls } from "./field";

type Audit = { firm: string; date: string; reportUrl: string; scope: string };
type Member = { name: string; role: string; link: string };
type Milestone = { title: string; date: string };

const EMPTY_AUDIT: Audit = { firm: "", date: "", reportUrl: "", scope: "" };
const EMPTY_MEMBER: Member = { name: "", role: "", link: "" };
const EMPTY_MILESTONE: Milestone = { title: "", date: "" };

const LINK_FIELDS = [
  "docs", "whitepaper", "github", "x", "telegram",
  "discord", "reddit", "blog", "youtube",
] as const;

export function StepTrust({
  cardId,
  website,
  onSaved,
  onDone,
}: {
  cardId: string;
  website: string;
  onSaved: (completeness: number, missing: string[]) => void;
  onDone: () => void;
}) {
  const t = useTranslations("coinCard.wizard");
  const [audits, setAudits] = useState<Audit[]>([{ ...EMPTY_AUDIT }]);
  const [legalEntity, setLegalEntity] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [teamDoxxed, setTeamDoxxed] = useState(false);
  const [members, setMembers] = useState<Member[]>([{ ...EMPTY_MEMBER }]);
  const [investors, setInvestors] = useState("");
  const [pitch, setPitch] = useState("");
  const [roadmap, setRoadmap] = useState<Milestone[]>([{ ...EMPTY_MILESTONE }]);
  const [mediaKit, setMediaKit] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [links, setLinks] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="space-y-8"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          // Four saves in sequence. Stop at the first failure so the user sees
          // which step broke instead of a half-written card.
          const steps: Array<{ section: "SECURITY" | "TEAM" | "MARKETING" | "LINKS"; payload: Record<string, unknown> }> = [
            {
              section: "SECURITY",
              payload: {
                security: {
                  audits: audits.filter((a) => a.firm.trim()),
                  legalEntity: legalEntity.trim() || null,
                  jurisdiction: jurisdiction.trim() || null,
                  teamDoxxed,
                },
              },
            },
            {
              section: "TEAM",
              payload: {
                teamInfo: {
                  members: members.filter((m) => m.name.trim()),
                  investors: investors.split("\n").map((s) => s.trim()).filter(Boolean),
                },
              },
            },
            {
              section: "MARKETING",
              payload: {
                marketing: {
                  pitch: pitch.trim() || null,
                  roadmap: roadmap.filter((r) => r.title.trim()),
                  mediaKit: mediaKit.trim() || null,
                  videoUrl: videoUrl.trim() || null,
                },
              },
            },
            {
              section: "LINKS",
              payload: {
                links: Object.fromEntries(
                  [["website", website], ...Object.entries(links)].filter(([, v]) => String(v).trim()),
                ),
              },
            },
          ];

          for (const s of steps) {
            const res = await saveCoinCardSection({ cardId, section: s.section, payload: s.payload });
            if (!res.ok) {
              setError(res.reason);
              return;
            }
            onSaved(res.completeness, res.missing);
          }
          onDone();
        });
      }}
    >
      <section className="space-y-4">
        <span className={labelCls}>{t("auditsLabel")}</span>
        {audits.map((a, i) => (
          <div key={i} className="border border-hairline rounded-md p-4 space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <Field id={`cc-af-${i}`} label={t("auditFirm")}>
                <input id={`cc-af-${i}`} value={a.firm} className={inputCls}
                  onChange={(e) => setAudits((xs) => xs.map((x, j) => (j === i ? { ...x, firm: e.target.value } : x)))} />
              </Field>
              <Field id={`cc-ad-${i}`} label={t("auditDate")}>
                <input id={`cc-ad-${i}`} value={a.date} type="date" className={inputCls}
                  onChange={(e) => setAudits((xs) => xs.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} />
              </Field>
            </div>
            <Field id={`cc-ar-${i}`} label={t("auditReport")}>
              <input id={`cc-ar-${i}`} value={a.reportUrl} className={inputCls}
                onChange={(e) => setAudits((xs) => xs.map((x, j) => (j === i ? { ...x, reportUrl: e.target.value } : x)))} />
            </Field>
            <Field id={`cc-as-${i}`} label={t("auditScope")}>
              <input id={`cc-as-${i}`} value={a.scope} className={inputCls}
                onChange={(e) => setAudits((xs) => xs.map((x, j) => (j === i ? { ...x, scope: e.target.value } : x)))} />
            </Field>
          </div>
        ))}
        <button type="button" className="text-accent text-sm"
          onClick={() => setAudits((xs) => [...xs, { ...EMPTY_AUDIT }])}>
          + {t("addAudit")}
        </button>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field id="cc-legal" label={t("legalEntity")}>
            <input id="cc-legal" value={legalEntity} className={inputCls}
              onChange={(e) => setLegalEntity(e.target.value)} />
          </Field>
          <Field id="cc-juris" label={t("jurisdiction")}>
            <input id="cc-juris" value={jurisdiction} className={inputCls}
              onChange={(e) => setJurisdiction(e.target.value)} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={teamDoxxed} onChange={(e) => setTeamDoxxed(e.target.checked)} />
          {t("teamDoxxed")}
        </label>
      </section>

      <section className="space-y-4">
        <span className={labelCls}>{t("teamLabel")}</span>
        {members.map((m, i) => (
          <div key={i} className="grid sm:grid-cols-3 gap-4">
            <input value={m.name} placeholder={t("memberName")} className={inputCls}
              onChange={(e) => setMembers((xs) => xs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <input value={m.role} placeholder={t("memberRole")} className={inputCls}
              onChange={(e) => setMembers((xs) => xs.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} />
            <input value={m.link} placeholder={t("memberLink")} className={inputCls}
              onChange={(e) => setMembers((xs) => xs.map((x, j) => (j === i ? { ...x, link: e.target.value } : x)))} />
          </div>
        ))}
        <button type="button" className="text-accent text-sm"
          onClick={() => setMembers((xs) => [...xs, { ...EMPTY_MEMBER }])}>
          + {t("addMember")}
        </button>
        <Field id="cc-investors" label={t("investors")} hint={t("investorsHint")}>
          <textarea id="cc-investors" value={investors} rows={3} className={inputCls}
            onChange={(e) => setInvestors(e.target.value)} />
        </Field>
      </section>

      <section className="space-y-4">
        <Field id="cc-pitch" label={t("pitch")} hint={t("pitchHint")}>
          <textarea id="cc-pitch" value={pitch} rows={4} className={`${inputCls} min-h-[120px]`}
            onChange={(e) => setPitch(e.target.value)} />
        </Field>
        <span className={labelCls}>{t("roadmap")}</span>
        {roadmap.map((r, i) => (
          <div key={i} className="grid sm:grid-cols-2 gap-4">
            <input value={r.title} placeholder={t("milestoneTitle")} className={inputCls}
              onChange={(e) => setRoadmap((xs) => xs.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
            <input value={r.date} placeholder="2026-Q3" className={inputCls}
              onChange={(e) => setRoadmap((xs) => xs.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} />
          </div>
        ))}
        <button type="button" className="text-accent text-sm"
          onClick={() => setRoadmap((xs) => [...xs, { ...EMPTY_MILESTONE }])}>
          + {t("addMilestone")}
        </button>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field id="cc-kit" label={t("mediaKit")}>
            <input id="cc-kit" value={mediaKit} className={inputCls}
              onChange={(e) => setMediaKit(e.target.value)} />
          </Field>
          <Field id="cc-video" label={t("videoUrl")}>
            <input id="cc-video" value={videoUrl} className={inputCls}
              onChange={(e) => setVideoUrl(e.target.value)} />
          </Field>
        </div>
      </section>

      <section className="space-y-4">
        <span className={labelCls}>{t("linksLabel")}</span>
        <div className="grid sm:grid-cols-2 gap-4">
          {LINK_FIELDS.map((k) => (
            <Field key={k} id={`cc-link-${k}`} label={t(`links.${k}`)}>
              <input id={`cc-link-${k}`} value={links[k] ?? ""} className={inputCls}
                onChange={(e) => setLinks((l) => ({ ...l, [k]: e.target.value }))} />
            </Field>
          ))}
        </div>
      </section>

      {error && <p className="text-down text-sm">{t(`errors.${error}`)}</p>}
      <button type="submit" disabled={pending} className={btnCls}>
        {pending ? t("saving") : t("finish")}
      </button>
    </form>
  );
}
