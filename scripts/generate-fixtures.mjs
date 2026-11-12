// Generates the two fake WhatsApp exports in /fixtures.
// Deterministic (seeded), so tests can rely on the output.
//   node scripts/generate-fixtures.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "fixtures"), { recursive: true });

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const pad = (n) => String(n).padStart(2, "0");
const DAY = 86400000;
const MIN = 60000;

// ---------- formatting ----------
function androidStamp(t) {
  const d = new Date(t);
  let h = d.getUTCHours();
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${String(d.getUTCFullYear()).slice(2)}, ${h}:${pad(d.getUTCMinutes())} ${ampm}`;
}
function iosStamp(t) {
  const d = new Date(t);
  let h = d.getUTCHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `[${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${String(d.getUTCFullYear()).slice(2)}, ${h}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} ${ampm}]`;
}

// ---------- shared generator ----------
/**
 * Build a message list from scripted episodes + random filler sessions.
 * episode: { at: "YYYY-MM-DD HH:mm", lines: [[who, text, gapMin?]] }
 */
function buildChat({ seed, start, end, people, weights, pools, episodes, sessionProb, quietRanges, sessionLen }) {
  const r = rng(seed);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const pickWeighted = () => {
    let x = r() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < people.length; i++) {
      x -= weights[i];
      if (x <= 0) return people[i];
    }
    return people[0];
  };
  const out = [];
  const episodeDays = new Set(episodes.map((e) => e.at.slice(0, 10)));
  const startT = Date.parse(start + "T00:00:00Z");
  const endT = Date.parse(end + "T00:00:00Z");

  for (let day = startT; day <= endT; day += DAY) {
    const iso = new Date(day).toISOString().slice(0, 10);
    if (episodeDays.has(iso)) continue;
    if (quietRanges.some(([a, b]) => iso >= a && iso <= b)) continue;
    const p = sessionProb(iso, r);
    let sessions = 0;
    if (r() < p) sessions = r() < 0.25 ? 2 : 1;
    const hours = [];
    for (let s = 0; s < sessions; s++) hours.push(pick([8, 10, 13, 13, 16, 18, 20, 21, 21, 22, 22, 23, 23, 0]));
    hours.sort((a, b) => (a || 24) - (b || 24));
    for (const hr of hours) {
      let t = day + (hr === 0 ? 24 * 60 : hr * 60) * MIN + Math.floor(r() * 50) * MIN;
      const n = sessionLen(r);
      let who = pickWeighted();
      for (let i = 0; i < n; i++) {
        if (i > 0) {
          // mostly alternate; sometimes the same person double-texts
          const share = weights[people.indexOf(who)] / weights.reduce((a, b) => a + b, 0);
          if (r() >= share * 0.9) {
            const others = people.filter((x) => x !== who);
            who = people.length === 2 ? others[0] : (() => { let n = who; while (n === who) n = pickWeighted(); return n; })();
          }
          t += Math.floor(1 + r() * (r() < 0.15 ? 90 : 12)) * MIN;
        }
        const roll = r();
        let text;
        if (roll < 0.05) text = "MEDIA";
        else if (roll < 0.06) text = "This message was deleted";
        else text = pick(pools[who](iso));
        out.push({ t: t + Math.floor(r() * 59) * 1000, who, text });
      }
      // occasional call after a session
      if (r() < 0.06) {
        t += 3 * MIN;
        const caller = pickWeighted();
        if (r() < 0.35) out.push({ t, who: caller, text: pick(["Missed voice call", "Missed video call"]) });
        else out.push({ t, who: caller, text: `Voice call, ${2 + Math.floor(r() * 40)} min` });
      }
    }
  }

  for (const ep of episodes) {
    let t = Date.parse(ep.at.replace(" ", "T") + ":00Z");
    for (const [who, text, gap = 1] of ep.lines) {
      out.push({ t, who, text });
      t += gap * MIN + Math.floor(r() * 40) * 1000;
    }
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

// ======================================================================
// 1) Anjali & Rahul — 2 people, Android format, ~1,500 messages, Manglish
// ======================================================================
const A = "Anjali";
const R = "Rahul";

const anjaliPool = (iso) => [
  "da evide", "class kazhinjo?", "enthu cheyyuva", "😂😂", "poda", "sathyam?", "food kazhicho?", "ok", "hmm",
  "njan urangan pova, gn 😴", "nale college undo?", "Rahul", "reply cheyy", "seen aakki pokalle 😑", "ithu kando 😂",
  "athe athe", "scene aanu", "chumma", "canteen il varunno?", "assignment theerno?", "Amma ninne anweshichu",
  "uff", "kollam", "aano", "sheri", "pinne?", "lol", "bore adikkunnu", "mess food 🤢", "?", "enthaa ithu 😂",
  "nee ente msg kando?", "call cheyyatte?", "ok bye", "sheri da", "🥲", "njan pinne parayam",
  "Did you eat or are you surviving on Maggi again?", "today was so long 😩", "hahaha", "athu kollam",
  ...(iso >= "2026-01-10" ? ["Bangalore engane und?", "office kazhinjo?", "nee ippo busy aano?", "miss cheyyunnu canteen chai 🥲"] : []),
  ...(iso >= "2026-07-01" ? ["placement prep 😵", "aptitude test nale", "resume onnu nokkamo?"] : []),
];
const rahulPool = (iso) => [
  "ividunde", "class il aanu", "ok da", "😂", "sheri", "pinne vilikkam", "chumma irikkunnu", "nee?", "hmm", "athe",
  "game kalikkuva", "kidilam", "gn", "potte", "kazhichu, nee?", "busy aanu, later", "ha ha", "ok bei", "enthaa",
  "nale nokkam", "😂😂😂", "seri seri", "ayyo", "lol", "pwoli", "evide?", "athe da", "sorry da, kandilla",
  "ninte charger ippozhum work aakunnund 😌", "chai?",
  ...(iso >= "2026-01-10" ? ["office il aanu", "traffic 😩", "standup kazhinju", "Bangalore weather 🥶", "Koramangala il aanu", "WFH today"] : []),
];

const coupleEpisodes = [
  { at: "2024-11-04 21:10", lines: [
    [R, "da ninte charger onnu tharumo, ente phone 3% aanu"], [A, "library il undo?"], [R, "aa, 2nd floor"],
    [A, "ok varunnu. return cheyyanam tto, last time pole alla", 6], [R, "promise 🤞", 900],
    [A, "charger evide 😑"], [R, "nale tharam"], [A, "nale ennu paranjal ninte nale alle, ariyam"] ] },
  { at: "2024-11-18 16:05", lines: [
    [R, "chai kudikkan varunno"], [A, "ninte treat aanel varam"], [R, "₹40 alle, njan tharam"], [A, "deal", 120],
    [A, "btw ninte ₹40 chai, njan aanu pay cheythe. GPay nokku"], [R, "next time njan 🙏"], [A, "noted 📝"] ] },
  { at: "2024-12-02 22:40", lines: [
    [A, "still waiting for my charger btw"], [R, "athu ippo ente charger aanu 😌"], [A, "💀"],
    [A, "Rahul that is THEFT"], [R, "long-term rental"], [A, "₹40 chai + charger. list valuthaakunnu"] ] },
  { at: "2025-01-22 01:12", lines: [
    [R, "Missed voice call"], [R, "da urangiyo"], [R, "urgent", 4], [A, "uranguvarunnu, entha?"],
    [R, "project report 9 am nu submit cheyyanam, ninte format onnu ayakkamo"], [A, "<Media omitted>", 3],
    [R, "you're a life saver 🙏"], [A, "ithum note cheythu.\n1. ₹40 chai\n2. charger\n3. ithu"], [R, "list il ninnu enne remove cheyy 😭"],
    [A, "never"] ] },
  { at: "2025-02-14 19:30", lines: [
    [A, "Valentine's day, single aayi canteen il irikkunnu 🙂"], [R, "same. nammal randum single club"],
    [R, "chai? ₹40 njan tharam, ithavana sathyam"], [A, "screenshot eduthu vechu 📸"], [R, "...", 30],
    [A, "Rahul nee GPay cheythilla 🙂"], [R, "UPI server down 😇"] ] },
  { at: "2025-03-10 06:12", lines: [
    [A, "Rahul urakkam aano"], [A, "emergency"], [A, "Missed voice call"], [R, "entha 😴", 2],
    [A, "Amma de car breakdown aayi, Ammu de exam 8:30 nu St. Teresa's il aanu, bus kittilla"],
    [R, "ithu 6 mani aanu Anjali"], [R, "ok 10 min"], [R, "vandi edukkunnu", 85],
    [R, "reached. hall ticket marannu poyi avalkku 🙃"], [A, "WHAT"],
    [R, "chill, njan thirichu poyi eduthu. 8:05 nu kodthu"], [A, "Rahul you absolute legend"],
    [A, "ninakku ente vaka biryani"], [R, "biryani + ₹40 chai cancel 😌"], [A, "chai cancel illa 😂"] ] },
  { at: "2025-03-10 13:40", lines: [[A, "Ammu said thanks. exam nannayi ezhuthi"], [R, "parayanda, njan ippozhum urakkathil aanu"]] },
  { at: "2025-05-21 22:30", lines: [
    [A, "ok cool"], [A, "nothing. just cool", 40], [R, "HAPPY BIRTHDAY ANJALI 🎂🎉🎉", 48],
    [R, "njan marannittilla. 11:58 strategic aanu, last wish ente aakanam ennu"], [A, "2 minute baakki undarnnu 😂"],
    [A, "but ok. accepted"], [R, "<Media omitted>"], [R, "gift Saturday tharam, athu ready aanu"],
    [A, "charger aano gift 😂"], [R, "...athu oru idea aanu"] ] },
  { at: "2025-07-03 18:05", lines: [
    [A, "inn ninte kude Lulu varamennu paranjittu?"], [A, "njan 5 mani muthal ivide aanu", 25],
    [R, "sorry da, Meenu vilichu, forgot"], [A, "ithu third time aanu Rahul."],
    [A, "eppozhum njan aanu plan cheyyunne, njan aanu message cheyyunne"], [R, "athu sheriyalla"],
    [A, "sheriyanu. scroll up cheythu nokku"], [R, "ok sorry, njan ippo varam"], [A, "ok. leave it."] ] },
  { at: "2025-07-13 20:41", lines: [
    [R, "<Media omitted>"], [R, "ithu kandappo ninne orthu"], [A, "....", 14], [A, "😂 poda"],
    [R, "Lulu Sunday? my treat. chai um"], [A, "₹40 chai um?"], [R, "₹40 chai um. sathyam"],
    [A, "ok. but you plan it this time"], [R, "deal. 11 am, food court, njan reserve cheyyam"] ] },
  { at: "2025-09-05 21:00", lines: [
    [R, "Goa plan final aano? Sid um Meera um varum"], [A, "train ticket ₹1,180 each"],
    [R, "njan book cheyyam, nee hotel nokku"], [A, "Baga il oru place undu, ₹4,700 for 3 nights"], [R, "pwoli, book it"] ] },
  { at: "2025-09-21 16:20", lines: [
    [R, "ente cheruppu kadal kondupoyi 🩴"], [A, "😂😂😂"], [A, "barefoot Rahul"], [R, "athu ippo ente peru aano"],
    [A, "Barefoot Rahul, Goa 2025. legend"], [R, "<Media omitted>"], [A, "aa photo njan framing cheyyum"] ] },
  { at: "2025-09-26 11:00", lines: [
    [A, "Goa split: hotel ₹4,700/2 = ₹2,350 nee enikku tharanam"], [R, "GPay cheythu ✅", 15],
    [A, "wow first time on time 😳"], [R, "Barefoot Rahul is a changed man"] ] },
  { at: "2025-12-08 17:44", lines: [
    [R, "DA"], [R, "GOT IT"], [R, "Flipkart internship, Bangalore, Jan muthal"], [A, "AAAAAAA"], [A, "I KNEW IT"],
    [A, "treat venam. ₹40 chai alla, proper treat"], [A, "Voice call, 34 min", 3], [R, "Amma karanju 😭"] ] },
  { at: "2026-01-05 22:15", lines: [
    [R, "Bangalore il chai ₹40 alla, ₹120 aanu 😭"], [A, "karma"], [R, "ninte charger ippozhum ente bag il undu btw"],
    [A, "athu Bangalore il poyo 💀"], [R, "it's a well-travelled charger now"] ] },
  { at: "2026-02-17 01:58", lines: [
    [A, "nale DBMS exam, onnum padichilla"], [R, "notes ayakkatte?"], [R, "<Media omitted>"], [R, "<Media omitted>"],
    [R, "<Media omitted>"], [R, "normalization, 3NF ivide simple aayi ezhuthiyittund"],
    [A, "ninakku urakkam ille? Bangalore il 2 mani aayi"], [R, "ninakkum ille 😂"], [A, "thank you. really.", 680],
    [A, "pass aakum. ninte notes il ninnu 2 question vannu"], [R, "pinne alla 😎"] ] },
  { at: "2026-04-11 20:10", lines: [
    [A, "Sunday shifting aanu, Kakkanad ninnu Edappally, aarum illa sahayikkan 😭"], [R, "njan Saturday night bus il varam"],
    [A, "seriously? Bangalore ninnu?"], [R, "biryani venam"], [A, "deal"] ] },
  { at: "2026-04-12 21:30", lines: [
    [A, "thanks for today. ₹500 biryani was worth it"], [R, "fridge thazhe vechappo ente back poyi"],
    [A, "you carried a fridge for me, njan athu marakkilla"], [R, "athu ninte list il add cheyyu, enikku vendi 😌"] ] },
  { at: "2026-08-20 19:12", lines: [
    [A, "3rd company um reject 😞"], [R, "Anjali, nee ente report format ezhuthiya aal aanu"],
    [R, "ninne reject cheythavarkku aanu loss"], [A, "you're annoyingly nice today"],
    [R, "₹40 chai kadam undu, ninne vidan pattilla"], [A, "😂 ok. resume onnu nokkamo?"], [R, "ayakku. ippo thanne"] ] },
  { at: "2026-10-02 10:30", lines: [
    [R, "da oru help. exam fee ₹1,200, salary 5th nu varum"], [A, "ayakkam"], [A, "sent. ₹40 chai il add cheyyunnu: ₹1,240"],
    [R, "😭"] ] },
  { at: "2026-10-06 09:05", lines: [
    [R, "₹1,240 ayachu ✅ chai um cleared"], [A, "after 2 years?!? historic day"], [R, "charger still mine though"] ] },
  { at: "2026-11-03 23:10", lines: [
    [A, "next May graduation aanu, believe cheyyan pattunnilla"], [R, "ninte charger ann tharam, promise"],
    [A, "😂 framing it"], [R, "seriously though. thanks for everything, Anjali"], [A, "poda. senti aakalle"],
    [A, "...thanks too"] ] },
];

const coupleMsgs = buildChat({
  seed: 42,
  start: "2024-11-01",
  end: "2026-11-05",
  people: [A, R],
  weights: [62, 38],
  pools: { [A]: anjaliPool, [R]: rahulPool },
  episodes: coupleEpisodes,
  quietRanges: [["2025-07-04", "2025-07-12"], ["2025-09-14", "2025-09-20"]],
  sessionProb: (iso) => {
    if (iso < "2025-04-01") return 0.65;
    if (iso < "2025-08-01") return 0.5;
    if (iso < "2026-01-10") return 0.6;
    if (iso < "2026-07-01") return 0.5;
    return 0.55;
  },
  sessionLen: (r) => 2 + Math.floor(r() * 3),
});

{
  const header = `01/11/24, 7:58 am - Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them. Tap to learn more.`;
  const lines = [header];
  for (const m of coupleMsgs) {
    const text = m.text === "MEDIA" ? "<Media omitted>" : m.text;
    lines.push(`${androidStamp(m.t)} - ${m.who}: ${text}`);
  }
  writeFileSync(join(root, "fixtures", "whatsapp-anjali-rahul.txt"), lines.join("\n") + "\n", "utf8");
  console.log("anjali-rahul:", coupleMsgs.length, "messages");
}

// ======================================================================
// 2) Hostel 4B — 5-person group, iOS format, ~800 messages
// ======================================================================
const G = ["Arjun", "Meera", "Sid", "Fathima", "Kevin"];
const [AR, ME, SI, FA, KE] = G;
const groupPools = {
  [AR]: () => ["guys", "aarenkilum mess il undo?", "😂😂", "ithu kando", "plan entha", "ok done", "Kevin evide 😂", "sheri", "night out?", "athe", "who's free tonight?"],
  [ME]: () => ["guys please", "attendance shortage aanu enikku 😭", "lol", "same", "athu kollam", "aarum reply cheyyunnilla", "ok fine", "hahaha", "Sid stop", "canteen?"],
  [SI]: () => ["bro", "😂", "naale nokkam", "lmao", "ente room il vaa", "food order cheyyatte?", "ayyo", "sheri bro", "GG", "who ate my Maggi"],
  [FA]: () => ["notes ayakkam", "ok", "😂", "class cancel aayi!!", "aaru varunnu library?", "athe", "kollam", "good night guys", "nope", "pwoli"],
  [KE]: () => ["👍", "seen", "ok", "late aakum", "😂"],
};
const groupEpisodes = [
  { at: "2025-06-02 20:00", lines: [
    [AR, "SYS:Arjun created group “Hostel 4B”"], [AR, "SYS:Arjun added Meera, Sid, Fathima and Kevin"],
    [AR, "welcome to the official 4B group 🏠"], [SI, "finally"], [ME, "rules: no forwarding good morning messages"],
    [FA, "😂 agreed"], [KE, "👍"] ] },
  { at: "2025-07-15 23:40", lines: [
    [SI, "guys njan purathu aanu"], [SI, "room locked"], [SI, "key ullil 🙃"], [AR, "😂😂😂"], [ME, "classic Sid"],
    [FA, "warden ne vilikku"], [SI, "warden urangi"], [AR, "ente room il vaa, floor undu"], [SI, "you're a real one"],
    [ME, "Locked-Out Sid, episode 1"] ] },
  { at: "2025-08-30 18:00", lines: [
    [ME, "Fathima's bday on 2nd. surprise plan?"], [AR, "cake njan order cheyyam"], [SI, "decorations me"],
    [ME, "Kevin you're in charge of keeping her busy"], [KE, "👍"], [AR, "cake ₹850 aanu, 5 per head ₹170"],
    [ME, "ok GPay cheyyam"] ] },
  { at: "2025-09-02 00:01", lines: [
    [AR, "HAPPY BIRTHDAY FATHIMA 🎂🎉"], [ME, "HBD Fathu 💛"], [SI, "happy bday!!! door open cheyy"],
    [FA, "GUYS 😭😭"], [FA, "<attached: cake.jpg>"], [KE, "happy birthday"], [ME, "Kevin wrote 2 words, historic"] ] },
  { at: "2025-10-10 21:15", lines: [
    [AR, "Munnar trip? 3 days"], [ME, "YES"], [FA, "exams kazhinju aanel ok"], [SI, "budget?"],
    [AR, "₹3,500 per head approx"], [KE, "late aakum, nokkam"], [ME, "Kevin 'nokkam' = no"] ] },
  { at: "2025-11-21 08:30", lines: [
    [AR, "Munnar update: bus ₹640 each, cottage ₹2,800 each"], [SI, "paid"], [FA, "paid ✅"], [ME, "paid"],
    [AR, "Kevin?", 300], [KE, "evening"], [AR, "Kevin.", 1440], [KE, "paid"] ] },
  { at: "2025-12-12 02:10", lines: [
    [FA, "aarenkilum unarnnirikkunno"], [ME, "OS exam nale, obviously"], [SI, "njan um"],
    [FA, "deadlock chapter onnum manassilakunnilla"], [AR, "Voice call, 48 sec"], [AR, "Missed group voice call"],
    [ME, "group call vaa, ellarum padikkam"], [AR, "Voice call, 1 hr 12 min", 75], [FA, "thank you guys 🥲 at least deadlock manassilayi"] ] },
  { at: "2026-02-20 13:00", lines: [
    [SI, "who ate my Maggi"], [SI, "serious question"], [ME, "not me"], [FA, "not me"], [AR, "😶"],
    [SI, "ARJUN"], [AR, "₹14 tharam"], [SI, "athu principle aanu bro"], [ME, "The Great Maggi Heist 2026"] ] },
  { at: "2026-05-30 19:00", lines: [
    [ME, "guys enikku Bangalore il internship kitti!!"], [AR, "MEERAAAA"], [SI, "treat!!"], [FA, "so proud 💛"],
    [KE, "congrats"], [ME, "July muthal. 4B il ninnu aadyam pokunnathu njan aanu 🥲"] ] },
  { at: "2026-09-14 22:00", lines: [
    [AR, "final year, last sem. weird feeling"], [FA, "don't 😭"], [SI, "one last Munnar?"],
    [ME, "I'll come down from Bangalore for that"], [KE, "in"], [AR, "KEVIN SAID IN WITHOUT 'nokkam'"],
    [SI, "screenshot eduthu"] ] },
];

const groupMsgs = buildChat({
  seed: 7,
  start: "2025-06-03",
  end: "2026-10-20",
  people: G,
  weights: [27, 25, 24, 18, 6],
  pools: groupPools,
  episodes: groupEpisodes,
  quietRanges: [["2025-12-20", "2026-01-02"]],
  sessionProb: () => 0.25,
  sessionLen: (r) => 3 + Math.floor(r() * 4),
});

{
  const lines = [`${iosStamp(Date.parse("2025-06-02T19:59:10Z"))} Hostel 4B: ‎Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them.`];
  for (const m of groupMsgs) {
    let text = m.text;
    if (text.startsWith("SYS:")) {
      lines.push(`${iosStamp(m.t)} Hostel 4B: ‎${text.slice(4)}`);
      continue;
    }
    if (text === "MEDIA" || text === "<Media omitted>") text = "‎" + ["image omitted", "sticker omitted", "image omitted", "GIF omitted"][m.t % 4];
    else if (/^(Missed|Voice call|Video call)/.test(text)) text = "‎" + text;
    lines.push(`${iosStamp(m.t)} ${m.who}: ${text}`);
  }
  writeFileSync(join(root, "fixtures", "whatsapp-hostel-group.txt"), lines.join("\n") + "\n", "utf8");
  console.log("hostel-group:", groupMsgs.length, "messages");
}
