import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultCampaignBrief, generateEmailCampaign, validateEmailCampaignBrief } from "./email-campaign";

test("generates the requested sequence length with personalized content", () => {
  const brief = createDefaultCampaignBrief("Acme Studio");
  const emails = generateEmailCampaign({
    ...brief,
    sequenceLength: 5,
    recipient: { firstName: "Priya", company: "Lumen Labs", role: "Marketing lead", painPoint: "turning launches into repeatable demand" },
  });

  assert.equal(emails.length, 5);
  assert.equal(emails[0].step, 1);
  assert.equal(emails[4].delay, "Day 14");
  assert.match(emails[0].body, /Hi Priya/);
  assert.match(emails[0].body, /Lumen Labs/);
  assert.match(emails[1].body, /turning launches into repeatable demand/);
});

test("respects personalization switches when generating a preview", () => {
  const brief = createDefaultCampaignBrief("Acme Studio");
  const emails = generateEmailCampaign({
    ...brief,
    sequenceLength: 1,
    personalization: { firstName: false, company: false, role: false, painPoint: false },
    recipient: { firstName: "Priya", company: "Lumen Labs", role: "Marketing lead", painPoint: "turning launches into repeatable demand" },
  });

  assert.equal(emails.length, 1);
  assert.match(emails[0].body, /Hi there/);
  assert.doesNotMatch(emails[0].body, /Priya|Lumen Labs|Marketing lead|turning launches into repeatable demand/);
});

test("reports actionable errors for an incomplete brief", () => {
  const brief = createDefaultCampaignBrief();
  const errors = validateEmailCampaignBrief({ ...brief, brandName: "", offer: "", callToAction: "" });

  assert.deepEqual(errors, ["Brand name is required.", "Offer or hook is required.", "Call to action is required."]);
  assert.deepEqual(generateEmailCampaign({ ...brief, brandName: "" }), []);
});
