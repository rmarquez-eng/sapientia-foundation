/* Sapientia Credit Dispute Center — client-side wizard.
 *
 * Modeled on vermilionvitez.com's member Credit Dispute Center: a 6-step
 * flow (intro → about you → your report → items → generate → mail & track)
 * with a letter registry whose `escalates_to` chain is the process — the
 * tracker reads response_days + escalates_to to compute the next step.
 *
 * Differences from the vitez version, on purpose:
 *  - No account. The whole case lives in localStorage on this device, so
 *    "the consumer keeps every record" is literal. Export/import as JSON.
 *  - Escalation stops at a CFPB / state-AG complaint. Anything past that is
 *    a referral to legal aid, per the Foundation's educational scope.
 *  - Letters are drafted for the participant to sign and send. Optional
 *    "Sapientia mails it" appears only when the LetterStream service is on.
 */
(function () {
  "use strict";
  var LS_KEY = "sapientia_dispute_case_v1";
  var DA_BASE = window.SAPIENTIA_DA_BASE || ""; // set to a docassemble origin to enable the guided interview
  var DA_INTERVIEW = window.SAPIENTIA_DA_INTERVIEW || "docassemble.playground1:credit_repair.yml";

  // --- bureaus (consumer-dispute addresses) -------------------------------
  var BUREAUS = {
    equifax: { name: "Equifax Information Services LLC", addr: "P.O. Box 740256\nAtlanta, GA 30374" },
    experian: { name: "Experian", addr: "P.O. Box 4500\nAllen, TX 75013" },
    transunion: { name: "TransUnion Consumer Solutions", addr: "P.O. Box 2000\nChester, PA 19016" }
  };

  // --- issue taxonomy → opening letter ----------------------------------
  var ISSUES = {
    not_mine: { label: "Not my account (mixed/merged file)", route: "bureau_dispute" },
    duplicate: { label: "Duplicate tradeline", route: "bureau_dispute" },
    wrong_status: { label: "Wrong account status", route: "bureau_dispute" },
    wrong_balance: { label: "Wrong balance / limit", route: "bureau_dispute" },
    bureau_mismatch: { label: "Reported differently across bureaus", route: "bureau_dispute" },
    personal_info: { label: "Wrong personal info (name/address/SSN/DOB)", route: "bureau_dispute" },
    obsolete: { label: "Past the 7-year (10 for bankruptcy) reporting limit", route: "bureau_dispute" },
    authorized_user: { label: "Authorized-user account shown as mine", route: "bureau_dispute" },
    late_payment: { label: "Late payment I dispute as inaccurate", route: "furnisher_late_verification" },
    late_payment_goodwill: { label: "Accurate one-time late (goodwill request)", route: "goodwill_adjustment" },
    collection: { label: "Third-party collection account", route: "debt_validation" },
    charge_off: { label: "Charge-off from the original creditor", route: "furnisher_dispute" },
    medical: { label: "Medical bill / medical collection", route: "hipaa_medical_dispute" },
    identity_theft: { label: "Account opened by identity theft", route: "bureau_id_theft_block" },
    unauthorized_inquiry: { label: "Hard inquiry I never authorized", route: "bureau_inquiry_removal" },
    zombie_debt: { label: "Time-barred debt being re-reported / re-aged", route: "sol_expired_notice" },
    harassment: { label: "Collector harassment", route: "cease_communication" }
  };

  // --- letter registry. body(ctx) -> string ----------------------------
  function header(ctx, toName, toAddr) {
    return [ctx.name, ctx.address, "SSN (last 4): " + ctx.ssn + "   DOB: " + ctx.dob, "",
      today(), "", toName, toAddr, ""].join("\n");
  }
  function itemTable(items) {
    if (!items.length) return "";
    return "Accounts / items in question:\n" + items.map(function (it) {
      return "  - " + it.creditor + "  (acct " + (it.account || "n/a") + ") — " +
        (ISSUES[it.issue] ? ISSUES[it.issue].label : it.issue) +
        (it.detail ? ": " + it.detail : "");
    }).join("\n") + "\n";
  }
  var SIGN = ["", "Sincerely,", "", "_____________________________", ""];

  var LETTERS = {
    bureau_dispute: {
      title: "Dispute to a credit bureau (FCRA 611)", to: "bureau",
      days: 30, escalates_to: "bureau_followup",
      body: function (c) {
        return header(c, c.recipientName, c.recipientAddr) +
          "Re: Request to investigate inaccurate information under 15 U.S.C. § 1681i\n\n" +
          "I am disputing the following item(s) in my credit file as inaccurate or unverifiable.\n\n" +
          itemTable(c.items) +
          "\nUnder the Fair Credit Reporting Act I request that you conduct a reasonable investigation, forward all relevant information to the furnisher, and delete or correct any item that cannot be verified as accurate and complete. Please send me the results of your investigation and an updated copy of my report.\n\n" +
          "Enclosed: copy of my government ID and proof of current address." +
          SIGN.join("\n") + c.name;
      }
    },
    bureau_followup: {
      title: "Follow-up: results incomplete or item reinserted", to: "bureau",
      days: 15, escalates_to: "bureau_mov_request",
      body: function (c) {
        return header(c, c.recipientName, c.recipientAddr) +
          "Re: Inadequate reinvestigation — 15 U.S.C. § 1681i(a)(6), (a)(7)\n\n" +
          "On " + (c.priorDate || "[date]") + " I disputed the item(s) below. Your response did not include a description of the reinvestigation or corrected results, or the item was reinserted without the required 5-day notice.\n\n" +
          itemTable(c.items) +
          "\nI again request deletion or full correction, plus a written description of how the reinvestigation was conducted, including the business name, address, and telephone number of each furnisher contacted." +
          SIGN.join("\n") + c.name;
      }
    },
    bureau_mov_request: {
      title: "Method-of-verification request", to: "bureau",
      days: 15, escalates_to: "cfpb_complaint",
      body: function (c) {
        return header(c, c.recipientName, c.recipientAddr) +
          "Re: Method of verification — 15 U.S.C. § 1681i(a)(7)\n\n" +
          "You reported the item(s) below as \"verified.\" I request the method of verification: the name of the person contacted at the furnisher, their title and phone number, the date of contact, and copies of any documents relied on.\n\n" +
          itemTable(c.items) +
          "\nIf you cannot produce this, the item was not reasonably investigated and must be deleted." +
          SIGN.join("\n") + c.name;
      }
    },
    bureau_inquiry_removal: {
      title: "Remove an unauthorized hard inquiry", to: "bureau",
      days: 30, escalates_to: "bureau_followup",
      body: function (c) {
        return header(c, c.recipientName, c.recipientAddr) +
          "Re: Unauthorized inquiry — 15 U.S.C. § 1681b\n\n" +
          "The hard inquiry(ies) below appear on my report. I did not apply for credit with these parties and did not authorize access to my file. I request that the inquiry(ies) be removed and that you tell me who requested my file and on what stated basis.\n\n" +
          itemTable(c.items) + SIGN.join("\n") + c.name;
      }
    },
    bureau_id_theft_block: {
      title: "Identity-theft block (FCRA 605B)", to: "bureau",
      days: 4, escalates_to: "cfpb_complaint",
      body: function (c) {
        return header(c, c.recipientName, c.recipientAddr) +
          "Re: Block of information resulting from identity theft — 15 U.S.C. § 1681c-2\n\n" +
          "The account(s) below resulted from identity theft. I am a victim and did not open or authorize them. Enclosed is my FTC Identity Theft Report (IdentityTheft.gov) and a copy of my ID.\n\n" +
          itemTable(c.items) +
          "\nUnder § 1681c-2 you must block this information within 4 business days of receiving this request and notify the furnisher." +
          SIGN.join("\n") + c.name;
      }
    },
    furnisher_dispute: {
      title: "Direct dispute to the creditor (FCRA 623)", to: "furnisher",
      days: 30, escalates_to: "cfpb_complaint",
      body: function (c) {
        return header(c, c.recipientName, c.recipientAddr) +
          "Re: Direct dispute of furnished information — 15 U.S.C. § 1681s-2(b)\n\n" +
          "You furnished the following information to the credit bureaus. It is inaccurate.\n\n" +
          itemTable(c.items) +
          "\nI request that you investigate, correct your records, and report the correction to every bureau you furnished to. If the information is accurate, send me the account records that support it." +
          SIGN.join("\n") + c.name;
      }
    },
    furnisher_late_verification: {
      title: "Verify a disputed late payment", to: "furnisher",
      days: 30, escalates_to: "bureau_dispute",
      body: function (c) {
        return header(c, c.recipientName, c.recipientAddr) +
          "Re: Disputed delinquency — 15 U.S.C. § 1681s-2\n\n" +
          "You report the late payment(s) below. I dispute them. Please send the payment records — due dates, dates received, and posting dates — that support each mark, or remove them.\n\n" +
          itemTable(c.items) + SIGN.join("\n") + c.name;
      }
    },
    goodwill_adjustment: {
      title: "Goodwill request (accurate one-time late)", to: "furnisher",
      days: 30, escalates_to: null,
      body: function (c) {
        return header(c, c.recipientName, c.recipientAddr) +
          "Re: Goodwill adjustment request\n\n" +
          "I value our relationship. " + (c.goodwillReason || "The late mark(s) below happened during a temporary hardship that has since resolved, and I have paid on time since.") + "\n\n" +
          itemTable(c.items) +
          "\nAs a goodwill gesture, I ask that you remove the late notation(s). This is not a dispute of accuracy." +
          SIGN.join("\n") + c.name;
      }
    },
    debt_validation: {
      title: "Debt validation (FDCPA 1692g)", to: "collector",
      days: 30, escalates_to: "debt_validation_followup",
      body: function (c) {
        return header(c, c.recipientName, c.recipientAddr) +
          "Re: Debt validation request — 15 U.S.C. § 1692g\n\n" +
          "You contacted me about the debt(s) below. I do not acknowledge any obligation. Within 30 days, validate each: the amount, the original creditor, and proof that you own or are authorized to collect it.\n\n" +
          itemTable(c.items) +
          "\nUntil you validate, cease collection activity and do not report or continue reporting this account to any credit bureau. Communicate with me in writing only." +
          SIGN.join("\n") + c.name;
      }
    },
    debt_validation_followup: {
      title: "Follow-up: continued collection without validation", to: "collector",
      days: 15, escalates_to: "bureau_failed_validation_notice",
      body: function (c) {
        return header(c, c.recipientName, c.recipientAddr) +
          "Re: Continued collection without validation — 15 U.S.C. § 1692g(b)\n\n" +
          "I requested validation on " + (c.priorDate || "[date]") + ". You have not provided it but have continued to collect and/or report. This violates § 1692g(b). Cease all activity and delete the tradeline, or provide complete validation now.\n\n" +
          itemTable(c.items) + SIGN.join("\n") + c.name;
      }
    },
    bureau_failed_validation_notice: {
      title: "Notice to bureau: collector failed to validate", to: "bureau",
      days: 30, escalates_to: "bureau_mov_request",
      body: function (c) {
        return header(c, c.recipientName, c.recipientAddr) +
          "Re: Reporting of an unvalidated debt — 15 U.S.C. § 1681i\n\n" +
          "The collection item(s) below are reported by a collector that failed to validate the debt after my timely request. The item is therefore unverifiable. Please investigate and delete.\n\n" +
          itemTable(c.items) + SIGN.join("\n") + c.name;
      }
    },
    sol_expired_notice: {
      title: "Time-barred / re-aged debt notice", to: "collector",
      days: 15, escalates_to: "cfpb_complaint",
      body: function (c) {
        return header(c, c.recipientName, c.recipientAddr) +
          "Re: Time-barred debt — 15 U.S.C. § 1681c(a), § 1692e\n\n" +
          "The debt(s) below are past the statute of limitations for suit and/or past the 7-year credit-reporting period, or the date of first delinquency has been improperly re-aged.\n\n" +
          itemTable(c.items) +
          "\nDo not sue on this debt, do not re-age it, and delete or correct the reporting. Confirm the original date of first delinquency in writing." +
          SIGN.join("\n") + c.name;
      }
    },
    hipaa_medical_dispute: {
      title: "Medical debt dispute", to: "furnisher",
      days: 30, escalates_to: "bureau_dispute",
      body: function (c) {
        return header(c, c.recipientName, c.recipientAddr) +
          "Re: Disputed medical account\n\n" +
          "The medical account(s) below are inaccurate or were reported prematurely. I dispute the amount and the reporting.\n\n" +
          itemTable(c.items) +
          "\nPlease verify the balance against the itemized bill and the insurer's explanation of benefits, correct any error, and confirm the account is eligible to report at all (paid medical collections and balances under the current threshold should not appear). Do not disclose diagnosis or treatment details in any response." +
          SIGN.join("\n") + c.name;
      }
    },
    cease_communication: {
      title: "Cease communication (FDCPA 1692c)", to: "collector",
      days: 10, escalates_to: null,
      body: function (c) {
        return header(c, c.recipientName, c.recipientAddr) +
          "Re: Cease communication — 15 U.S.C. § 1692c(c)\n\n" +
          "Stop all communication with me about the account(s) below, except to confirm that contact is ending or to notify me of a specific action. Do not call my phone or contact third parties.\n\n" +
          itemTable(c.items) +
          "\nThis is not an acknowledgment of the debt. Continued contact or reporting in violation of the FDCPA/FCRA will be documented." +
          SIGN.join("\n") + c.name;
      }
    },
    cfpb_complaint: {
      title: "CFPB complaint (cover letter / notes)", to: "regulator",
      days: 15, escalates_to: "state_ag_complaint",
      body: function (c) {
        return [c.name, c.address, "", today(), "",
          "Consumer Financial Protection Bureau",
          "Submitted online at consumerfinance.gov/complaint", "",
          "Complaint summary", "",
          "Company: " + (c.recipientName || "[bureau or furnisher]"),
          "I disputed the item(s) below directly and did not receive a lawful response within the required time.", "",
          itemTable(c.items),
          "Prior letters sent: " + (c.priorDate || "[dates]") + ". Certified mail receipts attached.",
          "Resolution requested: deletion or correction of the item(s), and written confirmation.",
          "", "— " + c.name].join("\n");
      }
    },
    state_ag_complaint: {
      title: "State Attorney General complaint", to: "regulator",
      days: 30, escalates_to: null,
      body: function (c) {
        return [c.name, c.address, "", today(), "",
          "Office of the Attorney General — Consumer Protection Division",
          "(" + (c.state || "your state") + ")", "",
          "Re: Credit reporting / debt collection complaint against " + (c.recipientName || "[company]"),
          "",
          "I have exhausted direct disputes and a CFPB complaint without resolution. Details and the item(s) at issue:",
          "", itemTable(c.items),
          "Enclosed: copies of every letter sent, certified-mail receipts, and the company's responses.",
          "", "— " + c.name,
          "",
          "If this involves potential legal claims, contact your local legal aid office or a consumer-rights attorney; this complaint does not substitute for legal advice."].join("\n");
      }
    }
  };

  function today() {
    return new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  }
  function addDays(n) {
    var d = new Date(); d.setDate(d.getDate() + n);
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // --- state -----------------------------------------------------------
  var S = load();
  function load() {
    try {
      var raw = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
      raw.me = raw.me || {};
      raw.items = raw.items || [];
      raw.letters = raw.letters || [];
      raw.step = raw.step || 0;
      return raw;
    } catch (e) {
      return { me: {}, items: [], letters: [], step: 0 };
    }
  }
  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) {}
    render();
  }

  var STEPS = ["Start", "About you", "Your report", "Items", "Generate", "Mail & track"];
  var mount;

  function render() {
    if (!mount) return;
    mount.innerHTML =
      progress() +
      '<div class="dc-panel">' + [stepIntro, stepMe, stepReport, stepItems, stepGenerate, stepTrack][S.step]() + "</div>" +
      nav();
    wire();
  }

  function progress() {
    return '<ol class="dc-prog">' + STEPS.map(function (label, i) {
      return '<li class="' + (i === S.step ? "on" : i < S.step ? "done" : "") + '" data-goto="' + i + '">' +
        '<span>' + (i + 1) + '</span>' + esc(label) + "</li>";
    }).join("") + "</ol>";
  }
  function nav() {
    return '<div class="dc-nav">' +
      (S.step > 0 ? '<button class="btn ghost" data-nav="-1">Back</button>' : "<span></span>") +
      (S.step < STEPS.length - 1 ? '<button class="btn" data-nav="1">Next</button>' : "") +
      "</div>";
  }

  function stepIntro() {
    return '<h2>How this works</h2>' +
      '<ol class="steps">' +
      '<li><h3>Tell us about you</h3><p>Your name and address go on every letter. Stored only on this device.</p></li>' +
      '<li><h3>Read your report</h3><p>Upload it and we flag likely errors, or add items by hand.</p></li>' +
      '<li><h3>Classify each item</h3><p>Pick what is wrong. That decides which letter opens the process.</p></li>' +
      '<li><h3>Generate and send</h3><p>We draft the letter. You review, sign, and mail it certified.</p></li>' +
      '<li><h3>Track and escalate</h3><p>We compute each deadline. When a response comes back — or does not — we name the exact next letter.</p></li>' +
      "</ol>" +
      '<div class="note"><strong>Educational and self-directed.</strong> Not credit repair, not legal advice. The Foundation charges you nothing. Your case never leaves this browser unless you export it.</div>' +
      (DA_BASE ? '<p style="margin-top:16px"><a class="btn" target="_blank" rel="noopener" href="' + esc(DA_BASE.replace(/\/$/, "")) + "/interview?i=" + encodeURIComponent(DA_INTERVIEW) + '">Prefer a guided interview? Open it &rarr;</a></p>' : "") +
      '<div class="dc-io"><button class="btn ghost" id="dc-export">Export my case (JSON)</button>' +
      '<label class="btn ghost">Import<input type="file" id="dc-import" accept="application/json" hidden></label>' +
      '<button class="btn ghost" id="dc-reset">Start over</button></div>';
  }

  function field(id, label, val, ph, type) {
    return '<label for="' + id + '">' + esc(label) + "</label><input id=\"" + id + "\" type=\"" + (type || "text") +
      "\" value=\"" + esc(val || "") + "\" placeholder=\"" + esc(ph || "") + "\">";
  }
  function stepMe() {
    var m = S.me;
    return '<h2>About you</h2><p class="dc-sub">This goes on every letter. Nothing is sent anywhere.</p>' +
      '<div class="tool">' +
      field("me-name", "Full legal name", m.name, "", "text") +
      '<label for="me-address">Mailing address</label><textarea id="me-address" rows="2" placeholder="Street&#10;City, ST ZIP">' + esc(m.address || "") + "</textarea>" +
      '<div class="row">' + "<div>" + field("me-state", "State", m.state, "e.g. Virginia") + "</div>" +
      "<div>" + field("me-phone", "Phone", m.phone, "") + "</div></div>" +
      '<div class="row">' + "<div>" + field("me-ssn", "SSN (last 4)", m.ssn, "1234") + "</div>" +
      "<div>" + field("me-dob", "Date of birth", m.dob, "MM/DD/YYYY") + "</div></div>" +
      "</div>";
  }

  function stepReport() {
    return '<h2>Your credit report</h2>' +
      '<p class="dc-sub">Get all three reports free at <a href="https://www.annualcreditreport.com" target="_blank" rel="noopener">annualcreditreport.com</a>. Upload one below — it is read in memory and never stored.</p>' +
      '<div class="tool">' +
      '<div class="dropzone" id="dc-dz"><input type="file" id="dc-file" accept="application/pdf" hidden><span id="dc-dzl">Choose a PDF or drag it here</span></div>' +
      '<label for="dc-paste" style="margin-top:16px">… or paste the report text</label><textarea id="dc-paste" rows="4"></textarea>' +
      '<button class="btn lg" id="dc-analyze" style="margin-top:14px">Analyze report</button>' +
      '<div id="dc-astatus" style="margin-top:12px;color:var(--muted);font-size:.93rem"></div>' +
      "</div>";
  }

  function issueSelect(id, val) {
    return '<select id="' + id + '"><option value="">— pick what is wrong —</option>' +
      Object.keys(ISSUES).map(function (k) {
        return '<option value="' + k + '"' + (k === val ? " selected" : "") + ">" + esc(ISSUES[k].label) + "</option>";
      }).join("") + "</select>";
  }
  function stepItems() {
    var rows = S.items.map(function (it, i) {
      return '<div class="dc-card"><div class="dc-card-h"><strong>' + esc(it.creditor || "(unnamed)") +
        "</strong><button class=\"dc-x\" data-del=\"" + i + "\">Remove</button></div>" +
        '<div class="dc-card-b">acct ' + esc(it.account || "n/a") +
        (it.flagged ? ' &middot; <span class="tag flag">flagged</span>' : "") + "</div>" +
        issueSelect("it-issue-" + i, it.issue) +
        '<input data-detail="' + i + '" placeholder="What is wrong (optional detail)" value="' + esc(it.detail || "") + '">' +
        "</div>";
    }).join("");
    return '<h2>What you are disputing</h2>' +
      '<p class="dc-sub">Analyzed accounts land here. Set what is wrong with each — that picks the opening letter.</p>' +
      '<div class="findings">' + (rows || '<p class="dc-sub">No items yet. Analyze a report or add one below.</p>') + "</div>" +
      '<h3 style="margin-top:22px">Add an item by hand</h3><div class="tool">' +
      '<div class="row"><div>' + field("ni-creditor", "Who reported it", "", "e.g. ABC Bank") + "</div>" +
      "<div>" + field("ni-account", "Account number", "", "last 4 is enough") + "</div></div>" +
      '<label>What kind of problem</label>' + issueSelect("ni-issue", "") +
      field("ni-detail", "Detail (optional)", "", "e.g. balance shown $5,000; paid in full 2024") +
      '<button class="btn" id="dc-add" style="margin-top:12px">Add item</button></div>';
  }

  function routeFor(items) {
    var r = null;
    items.forEach(function (it) { if (it.issue && ISSUES[it.issue]) r = r || ISSUES[it.issue].route; });
    return r;
  }
  function stepGenerate() {
    var chosen = S.items.filter(function (it) { return it.issue; });
    if (!chosen.length) return '<h2>Create your letter</h2><div class="note">Go back and classify at least one item first.</div>';
    var route = routeFor(chosen);
    var L = LETTERS[route];
    var toBureau = L.to === "bureau";
    return '<h2>Create your letter</h2>' +
      '<p class="dc-sub">Based on your items, the process opens with:</p>' +
      '<div class="dc-card"><strong>' + esc(L.title) + "</strong><div class=\"dc-card-b\">Goes to the " + esc(L.to) +
      ". Response window: " + L.days + " days." + (L.escalates_to ? " If that passes without a compliant response, the next letter is <em>" + esc(LETTERS[L.escalates_to].title) + "</em>." : "") + "</div></div>" +
      '<div class="tool">' +
      (toBureau
        ? '<label>Which bureau</label><select id="gen-bureau"><option value="equifax">Equifax</option><option value="experian">Experian</option><option value="transunion">TransUnion</option></select>'
        : field("gen-rname", "Recipient name", "", "creditor / collector name") +
          '<label for="gen-raddr">Recipient address</label><textarea id="gen-raddr" rows="2" placeholder="Street&#10;City, ST ZIP"></textarea>') +
      (route === "goodwill_adjustment" ? '<label for="gen-reason">Your goodwill explanation</label><textarea id="gen-reason" rows="3"></textarea>' : "") +
      '<button class="btn lg" id="dc-gen" style="margin-top:14px">Generate letter</button>' +
      "</div>" +
      '<div id="dc-genout"></div>';
  }

  function stepTrack() {
    if (!S.letters.length) return '<h2>Mail &amp; track</h2><div class="note">No letters yet. Generate one in the previous step.</div>';
    return '<h2>Mail &amp; track</h2><p class="dc-sub">Mail each letter certified and keep the receipt. Log what happens; we name the next step.</p>' +
      S.letters.map(function (lt, i) {
        var L = LETTERS[lt.route];
        var due = lt.sentDate ? addDaysFrom(lt.sentDate, L.days) : null;
        return '<div class="dc-card">' +
          '<div class="dc-card-h"><strong>' + esc(L.title) + '</strong><button class="dc-x" data-ldel="' + i + '">Remove</button></div>' +
          '<div class="dc-card-b">To the ' + esc(L.to) + (lt.recipient ? " — " + esc(lt.recipient) : "") + "</div>" +
          '<div class="dc-actions">' +
          '<button class="btn ghost" data-lview="' + i + '">View letter</button>' +
          (lt.sentDate
            ? '<span class="dc-tag">Sent ' + esc(lt.sentDate) + " · response due ~" + esc(due) + "</span>"
            : '<button class="btn" data-lsent="' + i + '">Mark mailed</button>') +
          (lt.sentDate && !lt.outcome ? '<button class="btn ghost" data-lresp="' + i + '">Record response</button>' : "") +
          (lt.outcome ? '<span class="dc-tag">' + esc(lt.outcome) + "</span>" : "") +
          "</div>" +
          (lt.outcome === "no response" || lt.outcome === "verified without proof" || lt.outcome === "refused"
            ? nextStepBox(lt) : "") +
          '<pre class="rawtext" data-lbody="' + i + '" style="display:none">' + esc(lt.body) + "</pre>" +
          "</div>";
      }).join("");
  }
  function nextStepBox(lt) {
    var next = LETTERS[lt.route].escalates_to;
    if (!next) return '<div class="note">This chain ends here. If the item is still wrong, contact your local legal aid office or a consumer-rights attorney.</div>';
    return '<div class="note"><strong>Next step:</strong> ' + esc(LETTERS[next].title) +
      '. <button class="btn" data-lesc="' + lt._route + '" data-next="' + next + '">Generate it</button></div>';
  }
  function addDaysFrom(dateStr, n) {
    var d = new Date(dateStr); if (isNaN(d)) return "?";
    d.setDate(d.getDate() + n);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  // --- letter build + output -----------------------------------------
  function buildLetter(route, opts) {
    opts = opts || {};
    var chosen = S.items.filter(function (it) { return it.issue && (!opts.onlyRoute || ISSUES[it.issue].route === route || true); });
    var L = LETTERS[route];
    var ctx = {
      name: S.me.name || "[Your name]", address: S.me.address || "[Your address]",
      ssn: S.me.ssn || "XXXX", dob: S.me.dob || "[DOB]", state: S.me.state || "",
      items: chosen,
      priorDate: opts.priorDate || "", goodwillReason: opts.reason || ""
    };
    if (L.to === "bureau") {
      var b = BUREAUS[opts.bureau || "equifax"];
      ctx.recipientName = b.name; ctx.recipientAddr = b.addr;
    } else if (L.to === "regulator") {
      ctx.recipientName = opts.rname || "";
    } else {
      ctx.recipientName = opts.rname || "[Recipient]";
      ctx.recipientAddr = opts.raddr || "[Recipient address]";
    }
    return {
      route: route, _route: route + "-" + Date.now(),
      recipient: ctx.recipientName,
      body: L.body(ctx),
      created: today(), sentDate: "", outcome: ""
    };
  }

  function letterOutHtml(idx) {
    var lt = S.letters[idx];
    return '<label style="margin-top:16px">Your letter — review and edit before sending</label>' +
      '<textarea id="dc-letter-text" rows="16">' + esc(lt.body) + "</textarea>" +
      '<div class="dc-actions" style="margin-top:10px">' +
      '<button class="btn" id="dc-copy">Copy</button>' +
      '<button class="btn ghost" id="dc-dl">Download .txt</button>' +
      '<button class="btn ghost" id="dc-print">Print / Save PDF</button>' +
      '<button class="btn" id="dc-tracknow">Save to Mail &amp; track</button>' +
      "</div><div id=\"dc-mailsvc\"></div>";
  }

  // --- wiring --------------------------------------------------------
  function wire() {
    mount.querySelectorAll("[data-goto]").forEach(function (el) {
      el.onclick = function () { var n = +el.dataset.goto; if (n <= S.step || canAdvance(S.step)) { S.step = n; save(); } };
    });
    mount.querySelectorAll("[data-nav]").forEach(function (el) {
      el.onclick = function () {
        var dir = +el.dataset.nav;
        if (dir > 0 && !canAdvance(S.step)) return;
        S.step = Math.max(0, Math.min(STEPS.length - 1, S.step + dir));
        save();
      };
    });

    if (S.step === 0) {
      byId("dc-export").onclick = exportCase;
      byId("dc-import").onchange = importCase;
      byId("dc-reset").onclick = function () {
        if (confirm("Delete this case from this browser?")) { S = { me: {}, items: [], letters: [], step: 0 }; save(); }
      };
    }
    if (S.step === 1) {
      ["name", "address", "state", "phone", "ssn", "dob"].forEach(function (k) {
        var el = byId("me-" + k);
        el.oninput = function () { S.me[k] = el.value; try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) {} };
      });
    }
    if (S.step === 2) wireReport();
    if (S.step === 3) wireItems();
    if (S.step === 4) wireGenerate();
    if (S.step === 5) wireTrack();
  }
  function byId(id) { return mount.querySelector("#" + id) || document.getElementById(id); }
  function canAdvance(step) {
    if (step === 1) return !!(S.me.name && S.me.address);
    return true;
  }

  function wireReport() {
    var dz = byId("dc-dz"), fi = byId("dc-file"), lbl = byId("dc-dzl"), st = byId("dc-astatus");
    dz.onclick = function () { fi.click(); };
    fi.onchange = function () { if (fi.files[0]) lbl.textContent = fi.files[0].name; };
    ["dragover", "dragleave", "drop"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) {
        e.preventDefault();
        dz.classList.toggle("drag", ev === "dragover");
        if (ev === "drop" && e.dataTransfer.files[0]) { fi.files = e.dataTransfer.files; lbl.textContent = e.dataTransfer.files[0].name; }
      });
    });
    byId("dc-analyze").onclick = async function () {
      st.textContent = "Analyzing…";
      try {
        var data;
        if (fi.files[0]) {
          var fd = new FormData(); fd.append("report", fi.files[0]);
          var res = await fetch("/api/credit-report/extract", { method: "POST", body: fd });
          data = await res.json();
          if (!res.ok) throw new Error(data.error || "Upload failed");
        } else {
          data = localAnalyze(byId("dc-paste").value);
        }
        var added = 0;
        (data.candidates || []).forEach(function (c) {
          if (S.items.some(function (x) { return x.account === c.accountNumber && x.creditor === c.creditorName; })) return;
          S.items.push({ creditor: c.creditorName, account: c.accountNumber, flagged: !!c.flagged, issue: "", detail: "" });
          added++;
        });
        st.textContent = added + " item(s) added. Go to the Items step to classify them.";
        save();
      } catch (e) { st.textContent = e.message || String(e); }
    };
  }
  function localAnalyze(text) {
    var lines = String(text).split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    var acctRe = /(?:account|acct)\.?\s*(?:number|no\.?|#)?\s*[:#-]?\s*([Xx*\d-]{4,20})/i;
    var neg = /(collection|charge[\s-]?off|repossession|delinquent|late payment|past due|derogatory|foreclosure|judgment)/i;
    var seen = {}, out = [];
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(acctRe); if (!m || seen[m[1]]) continue;
      var name = "";
      for (var j = i; j >= Math.max(0, i - 3); j--) {
        var c = lines[j].replace(acctRe, "").trim();
        if (c.length >= 3 && c.length <= 60 && /[A-Za-z]/.test(c)) { name = c; break; }
      }
      if (!name) continue; seen[m[1]] = 1;
      out.push({ creditorName: name, accountNumber: m[1], flagged: neg.test(lines.slice(Math.max(0, i - 2), i + 3).join(" ")) });
    }
    return { candidates: out };
  }

  function wireItems() {
    mount.querySelectorAll("[data-del]").forEach(function (el) {
      el.onclick = function () { S.items.splice(+el.dataset.del, 1); save(); };
    });
    S.items.forEach(function (it, i) {
      var sel = byId("it-issue-" + i);
      if (sel) sel.onchange = function () { S.items[i].issue = sel.value; save(); };
      var det = mount.querySelector('[data-detail="' + i + '"]');
      if (det) det.oninput = function () { S.items[i].detail = det.value; };
    });
    byId("dc-add").onclick = function () {
      var cr = byId("ni-creditor").value.trim();
      if (!cr) return;
      S.items.push({ creditor: cr, account: byId("ni-account").value.trim(), issue: byId("ni-issue").value, detail: byId("ni-detail").value.trim(), flagged: false });
      save();
    };
  }

  function wireGenerate() {
    var g = byId("dc-gen");
    if (!g) return;
    g.onclick = function () {
      var chosen = S.items.filter(function (it) { return it.issue; });
      var route = routeFor(chosen);
      var lt = buildLetter(route, {
        bureau: byId("gen-bureau") ? byId("gen-bureau").value : null,
        rname: byId("gen-rname") ? byId("gen-rname").value : "",
        raddr: byId("gen-raddr") ? byId("gen-raddr").value : "",
        reason: byId("gen-reason") ? byId("gen-reason").value : ""
      });
      S._draft = lt;
      byId("dc-genout").innerHTML = letterOutHtml_draft();
      wireDraft();
    };
  }
  function letterOutHtml_draft() {
    return '<div class="tool" style="margin-top:16px">' +
      '<label>Your letter — review and edit before sending</label>' +
      '<textarea id="dc-letter-text" rows="16">' + esc(S._draft.body) + "</textarea>" +
      '<div class="dc-actions" style="margin-top:10px">' +
      '<button class="btn" id="dc-copy">Copy</button>' +
      '<button class="btn ghost" id="dc-dl">Download .txt</button>' +
      '<button class="btn ghost" id="dc-print">Print / Save PDF</button>' +
      '<button class="btn" id="dc-savetrack">Save to Mail &amp; track</button>' +
      "</div></div>";
  }
  function wireDraft() {
    byId("dc-copy").onclick = function () { navigator.clipboard.writeText(byId("dc-letter-text").value); this.textContent = "Copied"; };
    byId("dc-dl").onclick = function () { dl(byId("dc-letter-text").value, "sapientia-letter.txt"); };
    byId("dc-print").onclick = function () { printText(byId("dc-letter-text").value); };
    byId("dc-savetrack").onclick = function () {
      S._draft.body = byId("dc-letter-text").value;
      S.letters.push(S._draft); delete S._draft;
      S.step = 5; save();
    };
  }

  function wireTrack() {
    mount.querySelectorAll("[data-lview]").forEach(function (el) {
      el.onclick = function () { var p = mount.querySelector('[data-lbody="' + el.dataset.lview + '"]'); p.style.display = p.style.display === "none" ? "block" : "none"; };
    });
    mount.querySelectorAll("[data-lsent]").forEach(function (el) {
      el.onclick = function () {
        var d = prompt("Date you mailed it (YYYY-MM-DD):", new Date().toISOString().slice(0, 10));
        if (d) { S.letters[+el.dataset.lsent].sentDate = d; save(); }
      };
    });
    mount.querySelectorAll("[data-lresp]").forEach(function (el) {
      el.onclick = function () {
        var o = prompt("What happened? Type one of: deleted / corrected / verified without proof / refused / no response");
        if (o) { S.letters[+el.dataset.lresp].outcome = o.trim().toLowerCase(); save(); }
      };
    });
    mount.querySelectorAll("[data-ldel]").forEach(function (el) {
      el.onclick = function () { S.letters.splice(+el.dataset.ldel, 1); save(); };
    });
    mount.querySelectorAll("[data-lesc]").forEach(function (el) {
      el.onclick = function () {
        var next = el.dataset.next;
        var prev = S.letters.filter(function (l) { return LETTERS[l.route].escalates_to === next; }).pop();
        var lt = buildLetter(next, {
          bureau: prev && BUREAUS[Object.keys(BUREAUS).find(function (k) { return BUREAUS[k].name === prev.recipient; })] ? Object.keys(BUREAUS).find(function (k) { return BUREAUS[k].name === prev.recipient; }) : "equifax",
          rname: prev ? prev.recipient : "",
          priorDate: prev ? prev.sentDate : ""
        });
        S.letters.push(lt); save();
      };
    });
  }

  function dl(text, name) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    a.download = name; a.click(); URL.revokeObjectURL(a.href);
  }
  function printText(text) {
    var w = window.open("", "_blank");
    w.document.write('<pre style="font:13px/1.5 Georgia,serif;white-space:pre-wrap;padding:1in">' + esc(text) + "</pre>");
    w.document.close(); w.print();
  }
  function exportCase() { dl(JSON.stringify(S, null, 2), "sapientia-dispute-case.json"); }
  function importCase(e) {
    var f = e.target.files[0]; if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      try { S = JSON.parse(r.result); S.me = S.me || {}; S.items = S.items || []; S.letters = S.letters || []; S.step = S.step || 0; save(); }
      catch (err) { alert("That file could not be read."); }
    };
    r.readAsText(f);
  }

  document.addEventListener("DOMContentLoaded", function () {
    mount = document.getElementById("dispute-center");
    if (mount) render();
  });
})();
