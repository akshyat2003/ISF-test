import { PRIVACY_NOTICE_VERSION } from "@sj/contracts";

export default function PrivacyPage() {
  return (
    <article className="card" style={{ maxWidth: 720 }}>
      <h1>Privacy notice</h1>
      <p className="notice notice-warn">
        Draft placeholder ({PRIVACY_NOTICE_VERSION}). The final notice is pending legal review (PRD TBD-32) and must
        replace this text before registration opens to the public.
      </p>
      <p>
        We collect your name, email, mobile number and startup details to process your Startup Jathara application,
        contact you about it and run the event. The final notice will describe purposes, recipients, retention and
        how to correct or delete your data.
      </p>
    </article>
  );
}
