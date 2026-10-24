import { getListPlansQueryKey, useListPlans } from "@workspace/api-client-react";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  HeartHandshake,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { Link } from "wouter";

import { Button, EmptyState, ErrorPanel, PublicFrame, SkeletonRows } from "@/components/ui-kit";

export function HomePage() {
  return (
    <PublicFrame>
      <main>
        <section className="hero-section">
          <div className="hero-copy enter">
            <p className="eyebrow">
              <span className="eyebrow-line" />A steadier way to care
            </p>
            <h1 className="serif">
              More presence.
              <br />
              <em>Less paperwork.</em>
            </h1>
            <p className="hero-description">
              Pastora brings prayer requests, counselling, appointments and everyday church responsibilities
              into one thoughtful workspace—so you can care for people without losing track of what needs your
              attention.
            </p>
            <div className="hero-actions">
              <Link href="/sign-up" className="button primary">
                Begin with your church <ArrowRight size={16} />
              </Link>
              <Link href="/features" className="text-link">
                Explore the workspace <ArrowDownRight size={16} />
              </Link>
            </div>
            <div className="hero-note">
              <span className="note-dot" />
              Made for the everyday rhythm of church life.
            </div>
          </div>
          <div className="hero-art enter" aria-hidden="true">
            <div className="arch arch-back" />
            <div className="arch arch-front">
              <div className="art-sun" />
              <div className="art-hill hill-one" />
              <div className="art-hill hill-two" />
              <div className="art-stem stem-a" />
              <div className="art-stem stem-b" />
              <div className="art-flower flower-a" />
              <div className="art-flower flower-b" />
              <div className="art-caption">
                <span>Care is a practice.</span>
                <span>Keep showing up.</span>
              </div>
            </div>
            <div className="art-note">
              <HeartHandshake size={18} />
              <span>
                A quiet place for
                <br />
                what needs tending.
              </span>
            </div>
          </div>
        </section>
        <section className="manifesto">
          <h2 className="serif">
            The work of ministry,
            <br />
            <em>held together.</em>
          </h2>
          <p className="manifesto-text">
            Ministry happens in conversations, requests, appointments and the little things that need
            following up. Pastora helps you keep them organised, so fewer things slip through the cracks.
          </p>
        </section>
        <section className="feature-band">
          <article className="feature-intro">
            <span className="chapter">01 / Care well</span>
            <h2 className="serif">
              Make space for
              <br />
              <em>the person.</em>
            </h2>
            <p>
              Give prayer requests and counselling enquiries a dedicated place. Review them, protect sensitive
              information and keep track of the people who need your attention.
            </p>
            <Link href="/features" className="under-link">
              Explore pastoral care <ArrowRight size={15} />
            </Link>
          </article>
          <div className="feature-visual" aria-hidden="true">
            <div className="care-paper">
              <div className="paper-top">
                <span>CARE INBOX</span>
                <span className="mini-status">A quiet reminder</span>
              </div>
              <div className="paper-rule" />
              <div className="paper-lines">
                <i />
                <i />
                <i />
                <i />
              </div>
              <div className="paper-footer">
                <span className="paper-seal">
                  <HeartHandshake size={18} />
                </span>
                <span>
                  Private by design
                  <br />
                  <b>Only the right people, in the right place.</b>
                </span>
              </div>
            </div>
            <div className="visual-leaf leaf-1" />
            <div className="visual-leaf leaf-2" />
          </div>
        </section>
        <section className="principles two-up">
          <div>
            <span className="chapter">02 / Follow through</span>
            <h3>Remember what needs doing.</h3>
            <p>
              Keep appointments, tasks, reminders, department reports and expense approvals organised in one
              workspace. Know what needs your attention without carrying everything in your head.
            </p>
          </div>
          <div>
            <span className="chapter">03 / Find your rhythm</span>
            <h3>A workspace that fits your church.</h3>
            <p>
              Set up your church workspace, organise responsibilities and give your team a clearer way to work
              together. Start with what you need and grow at your own pace.
            </p>
          </div>
        </section>
        <section className="discretion">
          <div className="discretion-mark">
            <LockKeyhole size={22} />
          </div>
          <div>
            <p className="eyebrow">Care, kept close.</p>
            <h2 className="serif">Pastoral care deserves discretion.</h2>
            <p>
              Pastora helps keep sensitive requests and counselling notes accessible only to authorised
              people, separate from everyday church administration.
            </p>
            <span className="discretion-tagline">Private care. Thoughtful follow-through.</span>
          </div>
        </section>
        <section className="closing-cta">
          <div>
            <h2 className="serif">
              Less to carry.
              <br />
              <em>More room to care.</em>
            </h2>
            <p className="closing-text">
              You don't need another complicated system. You need a clearer way to keep up with the people and
              responsibilities entrusted to you.
            </p>
            <p className="closing-text strong">Pastora gives your ministry a place to begin.</p>
          </div>
          <Link href="/sign-up" className="button cream-button">
            Begin with your church <ArrowRight size={16} />
          </Link>
        </section>
      </main>
    </PublicFrame>
  );
}

export function FeaturesPage() {
  const modules = [
    [
      "Pastoral care",
      "A private inbox for prayer, counselling and general care requests. Keep next steps and follow-up visible without exposing sensitive details elsewhere.",
      "01",
    ],
    ["Appointments", "Receive requests, confirm a time and keep the coming conversations in view.", "02"],
    [
      "Tasks & follow-through",
      "A clear place for your own work and responsibilities assigned across the workspace.",
      "03",
    ],
    ["QR links", "Create destination links for care, prayer, counselling and appointments.", "04"],
    [
      "Reports & expenses",
      "Give each department a place to report progress and submit expenses for review.",
      "05",
    ],
    [
      "Church settings",
      "Shape the public portal, appointment options, theme and retention preferences.",
      "06",
    ],
  ];
  return (
    <PublicFrame>
      <main className="inner-page">
        <div className="inner-heading">
          <p className="eyebrow">One workspace, thoughtfully held</p>
          <h1 className="serif">
            The practical side
            <br />
            <em>of pastoral care.</em>
          </h1>
          <p>Useful tools for the work that supports ministry—kept calm, clear and close at hand.</p>
        </div>
        <div className="module-list">
          {modules.map(([title, copy, num]) => (
            <article className="module-row" key={title}>
              <span>{num}</span>
              <h2 className="serif">{title}</h2>
              <p>{copy}</p>
              <ArrowUpRight size={18} />
            </article>
          ))}
        </div>
        <div className="soft-callout">
          <HeartHandshake />
          <p>
            <b>Pastoral care stays restricted.</b>
            <br />
            Access to private requests depends on your role and the permissions configured for your church.
          </p>
          <Link href="/sign-up" className="under-link">
            Create a workspace <ArrowRight size={15} />
          </Link>
        </div>
      </main>
    </PublicFrame>
  );
}

export function PricingPage() {
  const plans = useListPlans({ query: { queryKey: getListPlansQueryKey(), retry: 1 } });
  return (
    <PublicFrame>
      <main className="inner-page pricing-page">
        <div className="inner-heading">
          <p className="eyebrow">Plans for church work</p>
          <h1 className="serif">
            Clear before
            <br />
            <em>you commit.</em>
          </h1>
          <p>
            Plan details appear here only when configured for your workspace. No guessed prices or trial
            terms.
          </p>
        </div>
        {plans.isLoading ? (
          <SkeletonRows />
        ) : plans.isError ? (
          <ErrorPanel text="Plan information could not be loaded." retry={() => void plans.refetch()} />
        ) : plans.data?.length ? (
          <div className="plan-grid">
            {plans.data.map((plan) => (
              <article className="plan-card" key={plan.id}>
                <span className="eyebrow">{plan.configured ? "Available plan" : "Plan details pending"}</span>
                <h2 className="serif">{plan.name}</h2>
                <p>{plan.description}</p>
                <div className="plan-price">
                  {plan.configured && plan.monthlyPrice !== null ? (
                    <>
                      <strong>
                        {plan.billingCurrency || ""} {plan.monthlyPrice}
                      </strong>
                      <small> per month</small>
                    </>
                  ) : (
                    <strong>Contact us for details</strong>
                  )}
                </div>
                <ul>
                  {plan.features.map((f) => (
                    <li key={f}>
                      <Check size={15} />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button variant="outline" onClick={() => window.location.assign("/support")}>
                  Ask about this plan <ArrowRight size={14} />
                </Button>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Plans are being prepared"
            description="Plan options will appear when the church workspace has configured them."
          />
        )}
        <div className="pricing-footnote">
          <ShieldCheck size={17} />
          Billing is not available until a provider is configured.
        </div>
      </main>
    </PublicFrame>
  );
}

export function NotFound() {
  return (
    <PublicFrame>
      <main className="inner-page not-found">
        <p className="eyebrow">404 / Not found</p>
        <h1 className="serif">
          This page has
          <br />
          <em>gone quiet.</em>
        </h1>
        <p>The address may have changed or may not exist.</p>
        <Link className="button primary" href="/">
          Return home <ArrowRight size={15} />
        </Link>
      </main>
    </PublicFrame>
  );
}
