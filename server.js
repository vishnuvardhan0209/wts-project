const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "db.json");
const SESSION_DAYS = 7;
fs.mkdirSync(DATA_DIR, { recursive: true });

const starter = {
  surveys: [
    {
      id: "survey-student", title: "Student Satisfaction Survey",
      description: "Help us improve learning, facilities, and student support.",
      category: "Education", status: "active", anonymous: true,
      createdAt: new Date().toISOString(),
      questions: [
        { id: "q1", text: "How satisfied are you with the quality of teaching?", type: "rating", required: true },
        { id: "q2", text: "Which area should we improve first?", type: "choice", options: ["Teaching quality", "Library", "Campus facilities", "Student support"], required: true },
        { id: "q3", text: "Any additional suggestions?", type: "text", required: false }
      ]
    },
    {
      id: "survey-library", title: "Library Services Feedback",
      description: "Share your experience with library resources and services.",
      category: "Campus", status: "active", anonymous: true,
      createdAt: new Date().toISOString(),
      questions: [
        { id: "q4", text: "Rate the availability of books and resources.", type: "rating", required: true },
        { id: "q5", text: "How often do you use the library?", type: "choice", options: ["Daily", "Weekly", "Monthly", "Rarely"], required: true }
      ]
    }
  ],
  responses: [], users: [], sessions: []
};

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, expected] = stored.split(":");
  const actual = crypto.scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, "hex");
  return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
}
function safeString(v, max = 500) { return typeof v === "string" ? v.trim().slice(0, max) : ""; }
function loadDB() {
  try {
    if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify(starter, null, 2));
    const db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    db.users ||= []; db.sessions ||= []; db.responses ||= []; db.surveys ||= [];
    // Local demo administrator can be configured with environment variables.
    const adminEmail = (process.env.ADMIN_EMAIL || "admin@feedbackhub.local").toLowerCase();
    const adminPassword = process.env.ADMIN_PASSWORD || "Admin@12345";
    if (!db.users.some(u => u.role === "admin") && adminPassword.length >= 8) {
      db.users.push({
        id: crypto.randomUUID(), name: "Project Administrator", email: adminEmail,
        passwordHash: hashPassword(adminPassword), role: "admin", createdAt: new Date().toISOString()
      });
      fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    }
    return db;
  } catch (e) {
    console.error("Could not read database:", e.message);
    return structuredClone(starter);
  }
}
function saveDB(db) { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }
function send(res, status, body, type = "application/json; charset=utf-8", extraHeaders = {}) {
  res.writeHead(status, { "Content-Type": type, "X-Content-Type-Options": "nosniff", "Cache-Control":"no-store", ...extraHeaders });
  res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (data.length > 1_000_000) { reject(new Error("Request too large")); req.destroy(); }
    });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error("Invalid JSON")); }
    });
  });
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach(part => {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}
function publicUser(user) { return { id:user.id, name:user.name, email:user.email, role:user.role, createdAt:user.createdAt }; }
function getCurrentUser(req, db) {
  const sid = parseCookies(req).sid;
  if (!sid) return null;
  const session = db.sessions.find(s => s.id === sid && s.expiresAt > Date.now());
  return session ? db.users.find(u => u.id === session.userId) || null : null;
}
function requireUser(req, res, db) {
  const user = getCurrentUser(req, db);
  if (!user) { send(res, 401, { error: "Please log in to continue." }); return null; }
  return user;
}
function requireAdmin(req, res, db) {
  const user = requireUser(req, res, db);
  if (user && user.role !== "admin") { send(res, 403, { error: "Administrator access is required." }); return null; }
  return user;
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith("/api/")) {
    const db = loadDB();
    try {
      if (req.method === "GET" && pathname === "/api/health") return send(res, 200, { ok: true });

      if (req.method === "GET" && pathname === "/api/auth/me") {
        const user = getCurrentUser(req, db);
        return send(res, 200, { user: user ? publicUser(user) : null });
      }

      if (req.method === "POST" && pathname === "/api/auth/register") {
        const body = await readBody(req);
        const name = safeString(body.name, 100);
        const email = safeString(body.email, 254).toLowerCase();
        const password = typeof body.password === "string" ? body.password : "";
        if (name.length < 2) return send(res, 400, { error: "Enter your full name." });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res, 400, { error: "Enter a valid email address." });
        if (password.length < 8) return send(res, 400, { error: "Password must contain at least 8 characters." });
        if (db.users.some(u => u.email === email)) return send(res, 409, { error: "An account with this email already exists." });
        const user = { id: crypto.randomUUID(), name, email, passwordHash: hashPassword(password), role: "student", createdAt: new Date().toISOString() };
        db.users.push(user);
        const sid = crypto.randomBytes(32).toString("hex");
        db.sessions.push({ id:sid, userId:user.id, expiresAt:Date.now() + SESSION_DAYS*86400000 });
        saveDB(db);
        return send(res, 201, { user: publicUser(user) }, "application/json; charset=utf-8", {
          "Set-Cookie": `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS*86400}`
        });
      }

      if (req.method === "POST" && pathname === "/api/auth/login") {
        const body = await readBody(req);
        const email = safeString(body.email, 254).toLowerCase();
        const password = typeof body.password === "string" ? body.password : "";
        const user = db.users.find(u => u.email === email);
        if (!user || !verifyPassword(password, user.passwordHash))
          return send(res, 401, { error: "Incorrect email or password." });
        const sid = crypto.randomBytes(32).toString("hex");
        db.sessions = db.sessions.filter(s => s.expiresAt > Date.now() && s.userId !== user.id);
        db.sessions.push({ id:sid, userId:user.id, expiresAt:Date.now() + SESSION_DAYS*86400000 });
        saveDB(db);
        return send(res, 200, { user: publicUser(user) }, "application/json; charset=utf-8", {
          "Set-Cookie": `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS*86400}`
        });
      }

      if (req.method === "POST" && pathname === "/api/auth/logout") {
        const sid = parseCookies(req).sid;
        db.sessions = db.sessions.filter(s => s.id !== sid);
        saveDB(db);
        return send(res, 200, { message:"Logged out." }, "application/json; charset=utf-8", {
          "Set-Cookie":"sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
        });
      }

      if (req.method === "GET" && pathname === "/api/surveys") {
        const user = getCurrentUser(req, db);
        const surveys = db.surveys
          .filter(s => user?.role === "admin" || s.status === "active")
          .map(s => ({ ...s, responseCount: db.responses.filter(r => r.surveyId === s.id).length }));
        return send(res, 200, surveys);
      }

      if (req.method === "POST" && pathname === "/api/surveys") {
        const user = requireAdmin(req, res, db); if (!user) return;
        const body = await readBody(req);
        const title = safeString(body.title, 120);
        const description = safeString(body.description, 1000);
        const category = safeString(body.category, 60) || "General";
        if (!title) return send(res, 400, { error: "Survey title is required." });
        if (!Array.isArray(body.questions) || !body.questions.length) return send(res, 400, { error: "Add at least one question." });
        const questions = body.questions.map(q => {
          const type = ["rating", "choice", "text", "yesno"].includes(q.type) ? q.type : "text";
          return { id: crypto.randomUUID(), text: safeString(q.text, 300), type, required: q.required !== false,
            options: type === "choice" && Array.isArray(q.options) ? q.options.map(x=>safeString(x,100)).filter(Boolean).slice(0,12) : [] };
        }).filter(q => q.text && (q.type !== "choice" || q.options.length >= 2));
        if (!questions.length) return send(res, 400, { error: "Add valid questions. Choice questions need at least two options." });
        const survey = { id:crypto.randomUUID(), title, description, category, status:body.status==="draft"?"draft":"active",
          anonymous:body.anonymous !== false, creatorId:user.id, createdAt:new Date().toISOString(), questions };
        db.surveys.unshift(survey); saveDB(db); return send(res, 201, survey);
      }

      const surveyMatch = pathname.match(/^\/api\/surveys\/([^/]+)$/);
      if (req.method === "GET" && surveyMatch) {
        const survey = db.surveys.find(s=>s.id===surveyMatch[1]);
        if (!survey || (survey.status !== "active" && getCurrentUser(req,db)?.role !== "admin")) return send(res,404,{error:"Survey not found."});
        return send(res,200,survey);
      }

      const responseMatch = pathname.match(/^\/api\/surveys\/([^/]+)\/responses$/);
      if (req.method === "POST" && responseMatch) {
        const user = requireUser(req,res,db); if (!user) return;
        const survey = db.surveys.find(s=>s.id===responseMatch[1]);
        if (!survey || survey.status !== "active") return send(res,404,{error:"This survey is not available."});
        const body = await readBody(req); const answers = body.answers || {};
        if (!survey.allowMultiple && db.responses.some(r=>r.surveyId===survey.id && r.respondentId===user.id))
          return send(res,409,{error:"You have already submitted this survey."});
        for (const q of survey.questions) {
          const value=answers[q.id];
          if(q.required && (value===undefined || value===null || String(value).trim()==="")) return send(res,400,{error:`Please answer: ${q.text}`});
          if(value!==undefined && q.type==="rating" && !(Number(value)>=1 && Number(value)<=5)) return send(res,400,{error:"Ratings must be between 1 and 5."});
          if(value!==undefined && q.type==="choice" && !q.options.includes(value)) return send(res,400,{error:"Please select a valid option."});
          if(value!==undefined && q.type==="yesno" && !["Yes","No"].includes(value)) return send(res,400,{error:"Please select Yes or No."});
        }
        db.responses.push({id:crypto.randomUUID(),surveyId:survey.id,respondentId:survey.anonymous?undefined:user.id,answers,submittedAt:new Date().toISOString()});
        saveDB(db); return send(res,201,{message:"Thank you! Your feedback has been submitted."});
      }

      if (req.method === "GET" && pathname === "/api/analytics") {
        const user = requireAdmin(req,res,db); if(!user) return;
        const surveyId=url.searchParams.get("surveyId");
        const selected=surveyId?db.surveys.filter(s=>s.id===surveyId):db.surveys;
        const surveys=selected.map(s=>{
          const responses=db.responses.filter(r=>r.surveyId===s.id);
          const questions=s.questions.map(q=>{
            const vals=responses.map(r=>r.answers[q.id]).filter(v=>v!==undefined&&v!=="");
            if(q.type==="rating"){const nums=vals.map(Number).filter(n=>n>=1&&n<=5);return{id:q.id,text:q.text,type:q.type,total:nums.length,average:nums.length?+(nums.reduce((a,b)=>a+b,0)/nums.length).toFixed(1):0,distribution:[1,2,3,4,5].map(n=>({label:String(n),count:nums.filter(v=>v===n).length}))};}
            if(q.type==="choice"||q.type==="yesno"){const opts=q.type==="choice"?q.options:["Yes","No"];return{id:q.id,text:q.text,type:q.type,total:vals.length,distribution:opts.map(label=>({label,count:vals.filter(v=>v===label).length}))};}
            return{id:q.id,text:q.text,type:q.type,total:vals.length,comments:vals.slice(-10).map(v=>String(v).slice(0,500))};
          });
          return{id:s.id,title:s.title,category:s.category,responseCount:responses.length,questions};
        });
        return send(res,200,{surveys,totalResponses:db.responses.length});
      }

      if (req.method === "GET" && pathname === "/api/export.csv") {
        const user=requireAdmin(req,res,db); if(!user) return;
        const surveyId=url.searchParams.get("surveyId"); const surveys=db.surveys.filter(s=>!surveyId||s.id===surveyId);
        const rows=[["Survey","Question","Answer","Submitted At"]];
        for(const s of surveys){const qs=new Map(s.questions.map(q=>[q.id,q.text]));for(const r of db.responses.filter(r=>r.surveyId===s.id)){for(const[qid,answer]of Object.entries(r.answers)){rows.push([s.title,qs.get(qid)||qid,Array.isArray(answer)?answer.join(", "):String(answer),r.submittedAt]);}}}
        const csv=rows.map(row=>row.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\r\n");
        return send(res,200,csv,"text/csv; charset=utf-8",{"Content-Disposition":'attachment; filename="feedback-report.csv"'});
      }

      if (req.method === "GET" && pathname === "/api/admin/users") {
        const user=requireAdmin(req,res,db); if(!user) return;
        return send(res,200,db.users.map(publicUser));
      }
      return send(res,404,{error:"API route not found."});
    } catch(e) {
      console.error(e);
      return send(res,500,{error:e.message||"Server error."});
    }
  }

  let filePath = pathname === "/" ? path.join(PUBLIC,"index.html") : path.join(PUBLIC,pathname);
  filePath=path.normalize(filePath);
  if(!filePath.startsWith(PUBLIC)) return send(res,403,"Forbidden","text/plain");
  fs.readFile(filePath,(err,content)=>{
    if(err)return send(res,404,"File not found","text/plain; charset=utf-8");
    const ext=path.extname(filePath).toLowerCase();
    const types={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".json":"application/json; charset=utf-8"};
    send(res,200,content,types[ext]||"application/octet-stream");
  });
});
server.listen(PORT,()=>console.log(`Online Survey Portal running at http://localhost:${PORT}`));
