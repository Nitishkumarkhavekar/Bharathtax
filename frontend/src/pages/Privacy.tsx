import { MarketingShell } from "@/components/marketing/MarketingShell";

const SECTIONS: { h: string; p: string[] }[] = [
  { h: "1. Our approach", p: [
    "BharathTax is built for the Income-tax Department and tax professionals, where confidentiality of case data is paramount. We collect the minimum needed to run the Service, keep your data within your tenant, and never use content you upload to train shared models.",
  ]},
  { h: "2. Information we collect", p: [
    "Account information — name, work email, organisation, role and seat assignment, provisioned by your administrator.",
    "Content you provide — questions you ask, documents you upload for analysis, and drafts you generate.",
    "Usage and audit data — queries, document access, timestamps and token usage, recorded for security, billing and audit.",
  ]},
  { h: "3. How we use it", p: [
    "To provide the Service — retrieval, cited answers, drafting and export; to administer seats, licensing and billing; to secure the platform and maintain an audit trail; and to provide support you request. We do not sell your data.",
  ]},
  { h: "4. Data residency and tenancy", p: [
    "Documents and case data you upload are stored within your organisation's tenant and are access-controlled to your wing. For departments that require it, the platform can be deployed so that data never leaves the department's own environment (the appeals workflow runs in a desktop application specifically to meet this requirement).",
  ]},
  { h: "5. AI processing", p: [
    "Answering and drafting use grounded retrieval over primary legal sources plus a language model. Content sent for processing is used only to produce your result. On-demand features such as web search or translation call an external model only when you invoke them, and only with the text needed for that request.",
  ]},
  { h: "6. Sharing", p: [
    "We share data only with service providers who help us run the platform (for example hosting), under confidentiality obligations, and where required by law. A chat you choose to share via an internal link is visible only to signed-in BharathTax users who hold the link.",
  ]},
  { h: "7. Security", p: [
    "Access is authenticated and role-scoped; every access is audit-logged; secrets are held server-side. We apply reasonable technical and organisational measures appropriate to the sensitivity of tax data.",
  ]},
  { h: "8. Retention", p: [
    "We retain your data for as long as your account is active and as needed to provide the Service, meet audit obligations and comply with law. On termination, data export and deletion are handled per your agreement.",
  ]},
  { h: "9. Your choices", p: [
    "You can update your profile, manage the memory the assistant keeps about you, and delete your chats and documents. Administrators manage seats and organisation-level data. For other requests, contact us.",
  ]},
  { h: "10. Changes and contact", p: [
    "We may update this policy; material changes will be notified through the Service or to your administrator. For any privacy question or request, please use the contact page.",
  ]},
];

export default function Privacy() {
  return (
    <MarketingShell
      eyebrow="Legal"
      title="Privacy Policy"
      intro="How BharathTax collects, uses and protects your data — written for an audience that handles sensitive tax information."
    >
      <p className="text-[12.5px] text-slate-400 mb-8">Last updated: {new Date().getFullYear()}</p>
      <div className="space-y-8">
        {SECTIONS.map((s) => (
          <section key={s.h}>
            <h2 className="text-[17px] font-semibold text-slate-900">{s.h}</h2>
            {s.p.map((para, i) => (
              <p key={i} className="mt-2 text-[14.5px] text-slate-600 leading-relaxed">{para}</p>
            ))}
          </section>
        ))}
      </div>
      <p className="mt-10 text-[13px] text-slate-500 border-t border-slate-200 pt-6">
        This page is a plain-language summary. Where you have a signed data-processing or service
        agreement with BharathTax or Wenvia, that agreement governs.
      </p>
    </MarketingShell>
  );
}
