import { MarketingShell } from "@/components/marketing/MarketingShell";

const SECTIONS: { h: string; p: string[] }[] = [
  { h: "1. Acceptance of terms", p: [
    "These Terms of Service (\"Terms\") govern access to and use of the BharatTax platform, applications and services (the \"Service\"). By creating an account, signing in, or otherwise using the Service, you agree to these Terms on behalf of yourself and the organisation you represent.",
    "If you do not agree to these Terms, do not use the Service.",
  ]},
  { h: "2. Accounts and eligibility", p: [
    "Accounts are provisioned and approved by an administrator within your wing, department or firm. You are responsible for keeping your credentials confidential and for all activity under your account. Notify your administrator promptly of any unauthorised use.",
    "Each seat is licensed for a single named user. Sharing a seat or credential with others is not permitted.",
  ]},
  { h: "3. Acceptable use", p: [
    "You agree to use the Service only for lawful, professional tax-research and drafting purposes. You will not attempt to disrupt, reverse-engineer, or gain unauthorised access to the Service, upload unlawful content, or use the Service to store data you are not authorised to process.",
  ]},
  { h: "4. Nature of the output", p: [
    "BharatTax is a research and drafting assistant. Its answers and drafts are grounded in primary legal sources and cited, but they are not legal advice and may contain errors. Every output must be independently verified against the current Income-tax Act, Rules and CBDT circulars, and reviewed by a qualified officer or professional before it is relied upon or issued.",
    "You remain solely responsible for any decision, order or filing you make.",
  ]},
  { h: "5. Intellectual property", p: [
    "The Service, including its software, models, design and content, is owned by BharatTax and its licensors. These Terms grant you a limited, non-exclusive, non-transferable right to use the Service during your subscription. Documents and data you upload remain yours.",
  ]},
  { h: "6. Subscriptions and fees", p: [
    "Paid plans are billed as set out in your order or agreement. Free-trial access may be time- or usage-limited and withdrawn at any time. Fees are non-refundable except where required by law or expressly agreed.",
  ]},
  { h: "7. Availability and support", p: [
    "We work to keep the Service available and performant, but do not warrant uninterrupted or error-free operation. Planned maintenance and service levels, where applicable, are described in your agreement.",
  ]},
  { h: "8. Limitation of liability", p: [
    "To the maximum extent permitted by law, BharatTax is not liable for indirect, incidental or consequential losses, or for any decision made in reliance on the Service's output. Our total liability is limited to the fees paid for the Service in the twelve months preceding the claim.",
  ]},
  { h: "9. Termination", p: [
    "You or your administrator may stop using the Service at any time. We may suspend or terminate access for breach of these Terms or non-payment. On termination, your right to use the Service ends; export of your data is handled per your agreement and our Privacy Policy.",
  ]},
  { h: "10. Changes and contact", p: [
    "We may update these Terms from time to time; material changes will be notified through the Service or to your administrator. Continued use after an update constitutes acceptance. Questions about these Terms can be sent via the contact page.",
  ]},
];

export default function Terms() {
  return (
    <MarketingShell
      eyebrow="Legal"
      title="Terms of Service"
      intro="The terms under which the BharatTax platform is made available. Please read them carefully."
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
        This page is a plain-language summary intended for general information. Where you have a
        signed agreement with BharatTax or Wenvia, that agreement governs.
      </p>
    </MarketingShell>
  );
}
