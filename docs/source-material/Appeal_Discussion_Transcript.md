# IT-Appeal Tool — Requirements Discussion (Cleaned Transcript)

> **Source:** `IT - BMTC - APPEAL.m4a` (28:50, Hindi + English code-switched).
> Auto-transcribed locally with faster-whisper (medium); raw output in `transcript.txt` / `.srt`.
> This is a **faithful English cleanup** — the audio is noisy, so Hindi portions are reconstructed
> for meaning and English technical terms are preserved as spoken. Genuinely unclear spots are marked **[unclear]**.
> **Speakers:** **OFFICER** = the Income-Tax officer (CIT(A)/NFAC appeals side, the domain expert);
> **DEV** = the Formonex developer/team. Attribution is inferred from context where the recording is ambiguous.

---

## 1. The document set the tool ingests (00:00–00:35)

**OFFICER:** Look, I'll give Form 35, I'll give the Grounds of Appeal, the Statement of Facts (SOF) and the Written Submission — then the order follows. All these things crystallize. I've already tried this on a couple of tools — on Copilot, and on [another] tool — and it does manage it.

So there should be a **sample** of what exactly we upload — a full **annexure** of it: a Form 35, the assessment order, the demand notice — all these documents.

## 2. Inputs: the appealed order + the appellant's filings (00:35–01:10)

**OFFICER:** This is the assessment order — the order against which [the appeal is filed]. The order, plus the demand notice. The order will have a description in it. Upload both of those. Once those two are uploaded, that part is done.

Then after that comes the **Grounds of Appeal**, the **Statement of Facts**, and the **Written Submission** — these are all the **appellant's** documents.

## 3. Crystallising issue → ground → submission → counter (01:10–01:50)

**OFFICER:** So from this, what do we learn? The **issue**, and what the appellant's **submission** on it is. These all crystallize. For example, Ground of Appeal No. 1 — what's the submission on it, what's the issue, what were the grounds, what are the submissions. All those things. Then, as a **counter** to that, this order of ours [is drafted] — the order is taken as the counter.

**DEV:** We need to create it in favour of the department?

**OFFICER:** No — that's already been done. In that [assessment] order the AO has already done it; the **AO has done that**, he's given his rationale there. Now the **appellant's** submission is coming in against it — [the tool] will counter that. Submission vs. what's in the order.

## 4. Additional evidence & case law; distinguishing (01:50–04:45)

**OFFICER:** After that, not everything will be there — some things are now coming as **additional** [evidence]. The appellant [*"SSC"* in the audio = the assessee/appellant] is now submitting something he hadn't submitted before — say a **favourable case law**. [Our position:] on this issue it's already been decided, so that favourable case law won't apply — it's not applicable to me, so the AO did not do anything wrong. So [the tool] now has to **reverse / rebut** it.

That's the part I don't think your system can do **unless you have the data** — it'll come either from **Taxmann**, or from our **department server / department website**.

What a section says — that you'll find anywhere, you can just page through it; that's not a big deal. It's about three books, 3,000–4,000 pages — but that's the **basic** stuff. The **case law** is what's important, because that's where we get the **reasoning** — what someone wrote on a similar issue, what the courts said. That reasoning is what goes into drafting our order — in the **elaboration / discussion**, the *why* of the decision. For that, the tool needs the source material.

The appellant lays it out in folds: half the point is on this, the other half on the same issue, with slightly different treatment. He says "my facts are these," so in these facts maybe these things aren't applicable — "because of [my] status I got it decided in my favour." There can be three or four folds in one ground, and each paragraph addresses each fold. In the drafting [prompt] I give it two lines — "this won't apply for this reason." Then it **searches the favourable decisions** there, brings in the rationale, and writes it into my order: "given this, this and this — this won't apply."

That's all I need. That's why I wanted Copilot — so that my staff, who don't [know] these basic things — Grounds of Appeal and so on — [can do it]. That's what I was demonstrating.

## 5. Fetching data from Form 35 / ITBA (05:13–06:25)

**OFFICER:** The other thing — now, **fetching the data**: the Form 35 and all that, how will you do it? It's online, it's right there; I'll show you how the login happens — that part is basic, we can fetch from there.

So look — the **first paragraph** is done; it comes from Form 35, and it's the same for everyone, so the same para just comes through. Then the **Grounds of Appeal** come — it writes this much, and below it is its version. [If] you're printing it, it lifts it from there.

Then the **facts** — where are the facts taken from? From the order we're [appealing] — the **assessment order**, basically the assessment order and the **penalty order**, whichever it is. From there it raises the issue: what the AO said, how he made the addition — and gives a **summary**: this was like this.

## 6. Summary, our prior favourable orders, finding & decision (06:59–08:15)

**OFFICER:** The summary shouldn't be too elaborate — keep it routine. But it'll flag what's **deletable**; we also have a few of our own orders (two or three) that are favourable, [it shows] what they say.

After this, **we** give our **finding and decision**. It lifts that and prepares it too. The judgments — that's a **standard part**, standard.

Then here, the **submissions** — what they're saying. After this, we give our finding and decision — what the **law's position** is.

## 7. Independent-proceeding example; the issue matrix in Copilot (08:15–10:30)

**OFFICER:** On a couple of the prompts I gave — "will it [be] independent" — the appellant says "my [other] proceeding is still pending, so you can't adjudicate this." We said: no, that pendency is separate; this is an **independent proceeding**. After that it pulled in all the material — some of it the AI does, this part we do via Copilot.

I've got 400–500 of them. We've built a **matrix on an issue basis** — on this-and-this issue, this is what's seen. He uploaded it, so it helps a bit — if it's there it gives it from there; otherwise we still needed **Taxmann**.

We can draw a **distinction** — "no, this is different from your case, not applicable" — so that part of the drafting order is done. The staff also make mistakes, so we want it to become **100% proof**. The AI does do it — for show it plots it and it does build it — but if **you** build it [properly] it'll come out better. Right now it sometimes just **hallucinates** something.

## 8. Walking through ITBA; the deficiency check (10:30–13:55)

**OFFICER:** OK, so now we take all this — Form, certify, Grounds of Appeal. Let me show you — I'll open **ITBA** — how data is fetched there. [*navigates*]

When filing an appeal, if there's a **deficiency** in the appeal it'll be flagged — e.g. some documents you were supposed to attach but didn't, it'll point out that deficiency. That too was uploaded; it checks all of this — **Facts, Grounds, Issues, Submissions** — all of it.

[On sharing the file:] how should we share this — over WhatsApp, or on Drive? [unclear]

## 9. Pricing aside; the long-term goal — a self-contained module (13:55–15:55)

**OFFICER / DEV:** [Pricing discussion — partly unclear.] "I'm a developer, I'm a designer, I don't know the pricing." [unclear]

**OFFICER:** Next, improve it a bit — make your **own module**, load all the data, and have it run on your own computer; basically do all of it locally here. And where more input is needed, then a bit of **internet search** for recent facts. The court / case law would then come automatically — you give it a prompt and it gives you a favourable judgment. But the data has to be **original** — [it must be a] real judgment, not something it invented.

## 10. Events / case history; attachments & annexures (15:55–24:30)

**OFFICER:** [On ITBA fetching — the second big issue.] I'm heading to lunch; [I'll show] how the search works. There's a **separate network** here for speed — an [internet] network. [unclear]

There's also an **Events** thing — case history: which dates, what happened on which date.

The appellant uploads and gives a submission — that's important. [unclear long gap]

**OFFICER:** The major **problem (search/fetch)** for us is here: how to fetch the data from there.

[24:05] [The appellant] gives the **Statement of Facts**, but the **Written Submission** is separate. In the para he keeps writing "**for this purpose, please find Annexure A1**" — and that's a **bill**; whatever he's given is a bill. So as an attachment he gives "Bill is attached, copy of bill is attached as Annexure A1." That has to be **fetched**. If, after the attachment, there are similar [references], it keeps writing them out.

## 11. Categorise → folder → draft ("shell") order (24:50–27:10)

**OFFICER:** It writes an **acknowledgement** somewhere — that gets generated first. It can **read** it, so it can pilot it. Then it **categorises** everything — it prioritises and segregates. It segregates into **different folders** — Form 35 and everything goes [into its place] — different folders with the files inside.

From there we lifted it, fed it in, and out came the **shell order** [= draft order]. Once the draft order is out, my concern is the **mind-application** on the issue — what's there on this issue, what isn't; that search we'll do, the study will happen.

So if I can build all of this via Copilot, then... [trails off]

## 12. "Does Claude work?" — closing (27:10–end)

**DEV:** You all keep mentioning the name **Claude** — Claude? Does Claude work? [unclear]

**OFFICER:** I wasn't there [for that] — this was **faceless assessment**, the **system** wasn't my part, my part was the **law**. A separate team built the system; but I have a bit of the understanding, so [I can] explain it. I'm not an engineer. You [just] need to understand the **procedure** — the technical side we'll add. As I said, these days the net has everything. [ends]

---

### Reading notes
- **"SSC"** in the raw audio is almost certainly **"assessee"** (the appellant). **"ITBA"** = the Income-Tax Business Application portal (itba.incometax.gov.in). **"shell order"** = the draft appellate order skeleton.
- The conversation is one continuous demo: the officer shows his **current manual Copilot workflow** (driven by the system prompt in `Appeal Order tool.docx`) and asks the dev team to **automate** it end-to-end — especially the two hard parts: **(a) fetching documents from ITBA** and **(b) fetching real, non-hallucinated case law from Taxmann.**
