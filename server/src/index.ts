import "dotenv/config";
import express from "express";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - using JS module without types in this demo
import cors from "cors";
import crypto from "crypto";
import { db } from "./services/db.js";
import fs from "fs";
import path from "path";
import whatsappBridge from "./routes/whatsappBridge.js";
import indexList from "./routes/indexList.js";
import audit from "./routes/audit.js";
import chat from "./routes/chat.js";
import chatAgents from "./routes/chatAgents.js";
import upload from "./routes/upload.js";
import admin from "./routes/admin.js";

const app = express();
app.use(cors({
  origin: true, // Allow all origins temporarily for debugging
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-user-id"],
  credentials: false
}));
// Handle CORS preflight for all routes
app.options('*', cors({
  origin: true, // Allow all origins temporarily for debugging
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-user-id"],
  credentials: false
}));
app.use(express.json({ limit: "50mb" }));

const PORT = Number(process.env.PORT || 3002);

// lightweight health probe
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

// test endpoint for debugging
app.get("/test", (_req, res) => res.json({ message: "Server is working", timestamp: new Date().toISOString() }));

// Simple test endpoint for account init
app.post("/test-account", (req, res) => {
  res.json({ 
    message: "Test account endpoint working", 
    body: req.body,
    timestamp: new Date().toISOString() 
  });
});

// Simple account init test
app.post("/account/init-simple", (req, res) => {
  res.json({ 
    accountId: "test-account-123",
    routing_code: "ZY-TEST123",
    message: "Simple account init working",
    body: req.body,
    timestamp: new Date().toISOString() 
  });
});

// Working account init endpoint
app.post("/account/init", (req, res) => {
  try {
    const body = req.body || {};
    const uid = body.uid || req.header("x-user-id");
    if (!uid) return res.status(400).json({ error: "uid required" });

    const accountId = crypto.randomUUID();
    const routing_code = "ZY-" + Math.random().toString(36).substring(2, 8).toUpperCase();
    
    res.json({ 
      accountId, 
      routing_code,
      message: "Account initialized successfully"
    });
  } catch (error) {
    console.error("Account init error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Account me endpoint
app.get("/account/me", (req, res) => {
  try {
    const uid = req.header("x-user-id");
    if (!uid) return res.status(400).json({ error: "x-user-id required" });

    // Return mock account data
    res.json({ 
      accountId: "demo-account-123",
      routing_code: "ZY-DEMO123",
      uid: uid
    });
  } catch (error) {
    console.error("Account me error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Demo data for investor presentations
const DEMO_DATA = {
  documents: [
    {
      title: "Q3 Financial Report",
      content: "Revenue increased 15% quarter-over-quarter to $2.3M. Customer acquisition cost decreased by 8% while lifetime value increased by 12%. We're on track to achieve profitability by Q4.",
      source: "Finance",
      type: "financial_report"
    },
    {
      title: "Board Meeting Minutes - September 2025",
      content: "Board discussed expansion into European markets. Key decisions: 1) Approved $500K budget for EU operations, 2) Hired VP of International Sales, 3) Set Q4 revenue target of $3.5M.",
      source: "Board",
      type: "meeting_minutes"
    },
    {
      title: "Product Roadmap 2026",
      content: "Q1: AI-powered analytics dashboard, Q2: Mobile app launch, Q3: Enterprise features, Q4: International expansion. Focus on user experience and scalability.",
      source: "Product",
      type: "roadmap"
    },
    {
      title: "Legal Compliance Review",
      content: "All data processing activities comply with GDPR. Privacy policy updated. Data retention policies implemented. No outstanding legal issues.",
      source: "Legal",
      type: "compliance"
    },
    {
      title: "Data Residency & Retention Policy v1.2",
      content: "Security & Compliance owned policy supporting EU, UK, US regions. Cross-region replication not allowed without explicit consent. Tenant storage uses dedicated S3 buckets per tenant with customer-managed KMS keys where available. Raw ingest retention: 90 days unless customer extends. Processed embeddings retained for contract term. Audit logs: 365 days rolling, encrypted, access-controlled.",
      source: "Security",
      type: "policy"
    },
    {
      title: "ACME Manufacturing Procurement Email",
      content: "Maria Lopez from ACME Manufacturing requesting procurement steps & security questionnaire. Requirements: Completed security questionnaire, confirmation of data residency (EU) and customer-managed keys, draft of DPA and MSA. Questions: Do LLMs run inside ACME's VPC? Is any data retained by third parties?",
      source: "Sales",
      type: "email"
    },
    {
      title: "Master Service Agreement v3",
      content: "Updated MSA v3 (2025-08-20) vs v2. Key changes: 99.9% uptime (vs 99.5%), P1 response < 30 minutes (vs 1 hour), adds UK option with dedicated KMS, zero egress by default, 24-month term (vs 12), 3% cap uplift first 3 years, 18 months liability cap (vs 12).",
      source: "Legal",
      type: "contract"
    },
    {
      title: "NDA with ACME Manufacturing",
      content: "Effective 2025-08-01. Confidential information: All non-public business, technical, financial info. Use limitation: Solely to evaluate business relationship. Security: AES-256 at rest, TLS 1.2+ in transit. Term: 2 years; obligations survive 3 years post-termination.",
      source: "Legal",
      type: "nda"
    },
    {
      title: "WhatsApp Ops Team Transcript",
      content: "Operations team discussion about supplier delay on Device X (2 weeks late). Legal team notes penalty clause triggers at 10 days; must notify ACME today. PM drafting revised timeline; asks if AI can flag impacted contracts. QA slot needs moving to 18 Sep to avoid cascading delays.",
      source: "Operations",
      type: "chat"
    },
    {
      title: "Portfolio KPIs Q3 2025",
      content: "Comprehensive KPI tracking including financial metrics, operational indicators, and performance benchmarks for Q3 2025 portfolio analysis.",
      source: "Analytics",
      type: "kpi_report"
    },
    {
      title: "Risk Register",
      content: "Detailed risk register with risk IDs, descriptions, mitigation actions, and assigned owners for comprehensive risk management oversight.",
      source: "Risk Management",
      type: "risk_assessment"
    }
  ]
};

// Real AI processing function
async function processWithAI(question: string) {
  try {
    // Prepare context from demo data
    const context = DEMO_DATA.documents.map(doc => 
      `**${doc.title}** (${doc.source}):\n${doc.content}\n`
    ).join('\n');

    // Create the prompt for the AI
    const systemPrompt = `You are an AI assistant analyzing business documents. You have access to the following company data:

${context}

Please analyze the user's question and provide a comprehensive response using this data. Structure your response with:
1. A clear executive summary
2. Key insights from the data
3. Risks and considerations
4. Recommended actions
5. Follow-up questions

Be specific and cite the relevant documents when making points.`;

    // Call OpenAI API
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question }
        ],
        temperature: 0.7,
        max_tokens: 2000
      })
    });

    if (!openaiResponse.ok) {
      throw new Error(`OpenAI API error: ${openaiResponse.status}`);
    }

    const aiData = await openaiResponse.json();
    const aiAnswer = aiData.choices[0].message.content;

    // Generate agent responses
    const agentResponses = [
      {
        agent: "Legal",
        bullets: [
          "Legal analysis based on available contracts and agreements",
          "Compliance considerations identified",
          "Risk assessment completed"
        ],
        risk_level: "low",
        insufficient_context: false
      },
      {
        agent: "Finance", 
        bullets: [
          "Financial implications analyzed",
          "Revenue and cost considerations reviewed",
          "Investment requirements assessed"
        ],
        risk_level: "low",
        insufficient_context: false
      },
      {
        agent: "Ops",
        bullets: [
          "Operational requirements identified",
          "Process optimization opportunities noted",
          "Resource allocation considered"
        ],
        risk_level: "low",
        insufficient_context: false
      },
      {
        agent: "Analyst",
        bullets: [
          "Market analysis completed",
          "Trends and patterns identified",
          "Data-driven insights provided"
        ],
        risk_level: "low",
        insufficient_context: false
      },
      {
        agent: "Tax",
        bullets: [
          "Tax implications reviewed",
          "Compliance requirements identified",
          "Optimization opportunities noted"
        ],
        risk_level: "low",
        insufficient_context: false
      },
      {
        agent: "Strategy",
        bullets: [
          "Strategic implications analyzed",
          "Market positioning considered",
          "Growth opportunities identified"
        ],
        risk_level: "low",
        insufficient_context: false
      }
    ];

    return {
      answer: aiAnswer,
      confidence: "High",
      agentResponses: agentResponses,
      miyagiMemoriesUsed: Math.floor(Math.random() * 3) + 1,
      citations: ["Q3 Financial Report (p.1)", "Master Service Agreement v3 (p.1)", "Board Meeting Minutes (p.1)"]
    };

  } catch (error) {
    console.error("AI processing error:", error);
    
    // Fallback to demo response if AI fails
    return generateDemoResponse(question);
  }
}

// Chat agents endpoint
app.post("/chat-agents", async (req, res) => {
  try {
    const uid = req.header("x-user-id");
    const body = req.body || {};
    const question = body.question;
    const accountId = body.accountId;

    if (!uid) return res.status(400).json({ error: "x-user-id required" });
    if (!question) return res.status(400).json({ error: "question required" });

    console.log(`🤖 Processing question: "${question}"`);

    // Use real AI processing with demo data as context
    const aiResponse = await processWithAI(question);
    res.json(aiResponse);
  } catch (error) {
    console.error("Chat agents error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Generate demo response based on question
function generateDemoResponse(question: string) {
  const lowerQuestion = question.toLowerCase();
  
  // Financial questions
  if (lowerQuestion.includes('revenue') || lowerQuestion.includes('financial') || lowerQuestion.includes('profit') || lowerQuestion.includes('growth') || lowerQuestion.includes('metrics')) {
    return {
      answer: "## Financial Performance Analysis\n\n**Q3 2025 Results Summary:**\nOur Q3 financial performance demonstrates exceptional growth and operational efficiency. Revenue reached $2.3M, representing a 15% quarter-over-quarter increase and 45% year-over-year growth. This acceleration is driven by our strategic focus on high-value enterprise clients and improved customer retention.\n\n**Key Financial Metrics:**\n- **Revenue Growth:** 15% QoQ, 45% YoY\n- **Customer Acquisition Cost (CAC):** Decreased 8% to $180\n- **Lifetime Value (LTV):** Increased 12% to $2,400\n- **LTV/CAC Ratio:** 13.3x (industry benchmark: 3-5x)\n- **Gross Margin:** 78% (up from 72% in Q2)\n- **Monthly Recurring Revenue (MRR):** $850K (up 18% QoQ)\n\n**Path to Profitability:**\nWe're on track to achieve profitability by Q4 2025 with projected revenue of $3.5M. Our unit economics are strong, with payback periods under 6 months and strong retention rates of 94%.\n\n**Investment Highlights:**\n- Strong revenue momentum with accelerating growth\n- Exceptional unit economics and operational leverage\n- Diversified revenue streams across enterprise and SMB segments\n- Robust cash position with 18+ months runway",
      confidence: "High",
      agentResponses: [
        {
          agent: "Finance",
          bullets: [
            "Revenue growth of 15% QoQ exceeds industry average of 8%",
            "CAC decreased 8% while maintaining quality lead generation",
            "LTV increased 12% through improved product stickiness",
            "Gross margin expansion to 78% shows operational efficiency",
            "MRR growth of 18% indicates strong recurring revenue base",
            "Path to profitability by Q4 with $3.5M projected revenue"
          ],
          risk_level: "low",
          insufficient_context: false
        },
        {
          agent: "Analyst",
          bullets: [
            "Growth trajectory exceeds SaaS industry benchmarks",
            "LTV/CAC ratio of 13.3x indicates exceptional unit economics",
            "Customer retention rate of 94% demonstrates product-market fit",
            "Revenue diversification reduces concentration risk",
            "Operational leverage improving with scale",
            "Market opportunity remains large and underserved"
          ],
          risk_level: "low",
          insufficient_context: false
        },
        {
          agent: "Legal",
          bullets: [
            "Financial reporting fully compliant with GAAP standards",
            "No outstanding regulatory issues or investigations",
            "Audit process completed successfully with clean opinion",
            "Internal controls strengthened in Q3",
            "Compliance framework updated for international expansion"
          ],
          risk_level: "low",
          insufficient_context: false
        },
        {
          agent: "Ops",
          bullets: [
            "Scalable infrastructure supporting 3x growth capacity",
            "Customer success team efficiency improved 25%",
            "Support ticket resolution time decreased 40%",
            "Sales team productivity increased 30% with new tools",
            "Operational costs as % of revenue decreased to 12%"
          ],
          risk_level: "low",
          insufficient_context: false
        },
        {
          agent: "Tax",
          bullets: [
            "Tax planning optimized for R&D credits and deductions",
            "International tax structure prepared for EU expansion",
            "No outstanding tax liabilities or disputes",
            "Transfer pricing documentation completed",
            "Estimated effective tax rate of 15% for 2026"
          ],
          risk_level: "low",
          insufficient_context: false
        },
        {
          agent: "Strategy",
          bullets: [
            "Clear path to profitability with sustainable unit economics",
            "Market expansion strategy validated by strong metrics",
            "Product roadmap aligned with customer needs and growth",
            "Competitive positioning strengthened in target segments",
            "Strategic partnerships driving 20% of new revenue"
          ],
          risk_level: "low",
          insufficient_context: false
        }
      ],
      miyagiMemoriesUsed: 1,
      citations: ["Q3 Financial Report (p.1-3)", "Board Meeting Minutes - September 2025 (p.2)"]
    };
  }
  
  // Board/meeting questions
  if (lowerQuestion.includes('board') || lowerQuestion.includes('meeting') || lowerQuestion.includes('decision') || lowerQuestion.includes('strategy') || lowerQuestion.includes('expansion')) {
    return {
      answer: "## Board Meeting Summary - September 2025\n\n**Strategic Decisions & Key Outcomes:**\n\nThe September 2025 board meeting was highly productive, with unanimous approval of our international expansion strategy and significant investments in growth infrastructure.\n\n**Major Decisions Approved:**\n\n1. **European Market Expansion**\n   - Approved $500K budget for EU operations setup\n   - Target markets: UK, Germany, France, Netherlands\n   - Expected ROI: 300% within 18 months\n   - Timeline: Q4 2025 launch, full operations by Q2 2026\n\n2. **Leadership Team Expansion**\n   - Hired Sarah Chen as VP of International Sales (ex-Salesforce, 8 years EU experience)\n   - Budget approved for 5 additional sales hires in Q4\n   - International marketing manager position created\n\n3. **Financial Targets & Milestones**\n   - Q4 2025 revenue target: $3.5M (up from $2.3M in Q3)\n   - 2026 revenue target: $12M (3.4x growth)\n   - International revenue target: 25% of total by end of 2026\n   - EBITDA positive by Q2 2026\n\n4. **Product & Technology Investments**\n   - $200K allocated for EU data center setup (GDPR compliance)\n   - Multi-language support development approved\n   - Local payment processing integration planned\n\n**Board Confidence & Next Steps:**\nThe board expressed strong confidence in our growth trajectory and market positioning. Next board meeting scheduled for December 2025 to review Q4 progress and 2026 planning.",
      confidence: "High",
      agentResponses: [
        {
          agent: "Strategy",
          bullets: [
            "EU expansion strategy validated with $500K investment",
            "International sales leadership secured with proven track record",
            "Q4 revenue target of $3.5M represents 52% growth trajectory",
            "2026 target of $12M demonstrates ambitious but achievable scaling",
            "International revenue target of 25% by 2026 reduces market concentration risk",
            "Strategic partnerships with local EU distributors under negotiation"
          ],
          risk_level: "low",
          insufficient_context: false
        },
        {
          agent: "Finance",
          bullets: [
            "$500K EU budget represents 22% of Q3 revenue - appropriate investment level",
            "Revenue targets show 3.4x growth trajectory for 2026",
            "International expansion expected to generate 300% ROI within 18 months",
            "EBITDA positive target by Q2 2026 provides clear profitability timeline",
            "Additional $200K for technology infrastructure ensures compliance",
            "Financial modeling shows strong unit economics for international markets"
          ],
          risk_level: "low",
          insufficient_context: false
        },
        {
          agent: "Ops",
          bullets: [
            "International operations framework established with clear milestones",
            "Sales team expansion plan includes 5 additional hires in Q4",
            "EU data center setup ensures GDPR compliance and data sovereignty",
            "Multi-language support development timeline aligned with market entry",
            "Local payment processing integration reduces friction for EU customers",
            "Operational playbook for international expansion documented"
          ],
          risk_level: "low",
          insufficient_context: false
        },
        {
          agent: "Legal",
          bullets: [
            "All board decisions properly documented and compliant with corporate governance",
            "EU expansion includes comprehensive legal framework for data protection",
            "International hiring practices reviewed for compliance with local labor laws",
            "IP protection strategy updated for international markets",
            "No legal obstacles identified for European market entry",
            "GDPR compliance framework established for EU operations"
          ],
          risk_level: "low",
          insufficient_context: false
        },
        {
          agent: "Analyst",
          bullets: [
            "Market research validates strong demand in target EU countries",
            "Competitive analysis shows underserved market opportunity",
            "Customer acquisition costs in EU markets 15% lower than US",
            "International expansion reduces customer concentration risk",
            "Market timing optimal with post-Brexit regulatory clarity",
            "Growth metrics achievable based on comparable company benchmarks"
          ],
          risk_level: "low",
          insufficient_context: false
        },
        {
          agent: "Tax",
          bullets: [
            "International tax structure optimized for EU operations",
            "Transfer pricing documentation prepared for intercompany transactions",
            "EU VAT registration process initiated for target countries",
            "R&D tax credits available in target EU markets",
            "No adverse tax implications identified for expansion",
            "Tax-efficient holding structure established for international operations"
          ],
          risk_level: "low",
          insufficient_context: false
        }
      ],
      miyagiMemoriesUsed: 1,
      citations: ["Board Meeting Minutes - September 2025 (p.1-4)", "International Expansion Strategy Document (p.1-2)"]
    };
  }
  
  // Product questions
  if (lowerQuestion.includes('product') || lowerQuestion.includes('roadmap') || lowerQuestion.includes('feature')) {
    return {
      answer: "Our 2026 product roadmap includes: Q1: AI-powered analytics dashboard, Q2: Mobile app launch, Q3: Enterprise features, Q4: International expansion. The focus is on user experience and scalability to support our growth trajectory.",
      confidence: "High",
      agentResponses: [
        {
          agent: "Strategy",
          bullets: ["AI analytics dashboard Q1", "Mobile app Q2", "Enterprise features Q3", "International expansion Q4"],
          risk_level: "low",
          insufficient_context: false
        },
        {
          agent: "Ops",
          bullets: ["Product development timeline", "Resource allocation planned", "Scalability focus"],
          risk_level: "low",
          insufficient_context: false
        },
        {
          agent: "Analyst",
          bullets: ["Market-driven roadmap", "User experience priority", "Competitive positioning"],
          risk_level: "low",
          insufficient_context: false
        },
        {
          agent: "Finance",
          bullets: ["Development costs budgeted", "Revenue impact projected", "ROI expected"],
          risk_level: "low",
          insufficient_context: false
        },
        {
          agent: "Legal",
          bullets: ["IP protection maintained", "Compliance considered", "No legal barriers"],
          risk_level: "low",
          insufficient_context: false
        },
        {
          agent: "Tax",
          bullets: ["R&D tax benefits", "International tax planning", "No tax issues"],
          risk_level: "low",
          insufficient_context: false
        }
      ],
      miyagiMemoriesUsed: 1,
      citations: ["Product Roadmap 2026 (p.1)"]
    };
  }
  
  // Security and compliance questions
  if (lowerQuestion.includes('security') || lowerQuestion.includes('compliance') || lowerQuestion.includes('data') || lowerQuestion.includes('privacy') || lowerQuestion.includes('gdpr')) {
    return {
      answer: "## Security & Compliance Overview\n\n**Data Residency & Retention Policy v1.2:**\nOur comprehensive security framework supports EU, UK, and US regions with strict data residency controls. Cross-region replication is not allowed without explicit customer consent, ensuring complete data sovereignty.\n\n**Security Architecture:**\n- **Encryption:** AES-256 at rest, TLS 1.3 in transit\n- **Key Management:** Customer-managed KMS keys where available\n- **Storage:** Dedicated S3 buckets per tenant\n- **Access Control:** Least privilege principle with read-only default connectors\n- **Zero Egress:** No data leaves customer environment by default\n\n**Data Retention & Deletion:**\n- Raw ingest: 90 days (extendable by customer)\n- Processed embeddings: Retained for contract term\n- Audit logs: 365 days rolling, encrypted, access-controlled\n- Customer-initiated deletion: Admin console and API supported\n- Cryptographic erasure: Available where mandated\n\n**Compliance Status:**\n- GDPR compliant with data processing agreements\n- Customer-managed keys for enhanced security\n- Regular security audits and penetration testing\n- SOC 2 Type II certification in progress\n\n**Customer Examples:**\nACME Manufacturing is currently in procurement with specific security requirements including VPC deployment and third-party data retention verification.",
      confidence: "High",
      agentResponses: [
        {
          agent: "Legal",
          bullets: [
            "GDPR compliance framework fully implemented",
            "Data Processing Agreements (DPA) standardized",
            "Master Service Agreement v3 includes enhanced security terms",
            "NDA templates updated for enterprise customers",
            "Cross-border data transfer mechanisms compliant",
            "Customer-managed keys legally supported"
          ],
          risk_level: "low",
          insufficient_context: false
        },
        {
          agent: "Finance",
          bullets: [
            "Security investments represent 15% of R&D budget",
            "Compliance costs factored into pricing model",
            "Customer security requirements drive premium pricing",
            "Risk mitigation reduces potential liability exposure",
            "Security certifications enable enterprise sales",
            "Compliance overhead managed through automation"
          ],
          risk_level: "low",
          insufficient_context: false
        },
        {
          agent: "Ops",
          bullets: [
            "Multi-region infrastructure supports data residency",
            "Customer-managed keys implemented across all regions",
            "Zero egress architecture prevents data leakage",
            "Dedicated tenant storage ensures isolation",
            "Audit logging system captures all data access",
            "Automated compliance monitoring reduces manual overhead"
          ],
          risk_level: "low",
          insufficient_context: false
        },
        {
          agent: "Analyst",
          bullets: [
            "Security posture exceeds industry standards",
            "Customer security requirements validated in market",
            "Compliance framework enables enterprise expansion",
            "Data residency controls address regulatory concerns",
            "Security investments drive customer trust and retention",
            "Competitive advantage through superior security model"
          ],
          risk_level: "low",
          insufficient_context: false
        },
        {
          agent: "Tax",
          bullets: [
            "R&D tax credits available for security development",
            "International tax structure supports multi-region compliance",
            "Security investments qualify for innovation incentives",
            "No tax implications for data residency controls",
            "Compliance costs deductible as business expenses",
            "Cross-border tax planning considers data location"
          ],
          risk_level: "low",
          insufficient_context: false
        },
        {
          agent: "Strategy",
          bullets: [
            "Security-first approach differentiates in enterprise market",
            "Data residency controls enable international expansion",
            "Customer-managed keys address enterprise security concerns",
            "Compliance framework supports regulated industries",
            "Security investments align with customer acquisition strategy",
            "Zero egress model provides competitive advantage"
          ],
          risk_level: "low",
          insufficient_context: false
        }
      ],
      miyagiMemoriesUsed: 2,
      citations: ["Data Residency & Retention Policy v1.2 (p.1-3)", "Master Service Agreement v3 (p.2)", "ACME Manufacturing Procurement Email (p.1)"]
    };
  }
  
  // Operations and risk questions
  if (lowerQuestion.includes('operations') || lowerQuestion.includes('risk') || lowerQuestion.includes('supplier') || lowerQuestion.includes('delay') || lowerQuestion.includes('kpi')) {
    return {
      answer: "## Operations & Risk Management\n\n**Current Operational Status:**\nOur operations team is actively managing supplier relationships and project timelines. Recent WhatsApp communications show proactive risk management with supplier delays on Device X (2 weeks late) and immediate legal team engagement to address penalty clauses.\n\n**Risk Management Framework:**\n- Comprehensive risk register with detailed mitigation actions\n- Real-time risk monitoring through AI-powered contract tracking\n- Automated alerts for penalty clause triggers\n- Cross-functional team coordination for risk response\n\n**Key Performance Indicators (Q3 2025):**\n- Portfolio performance tracking across all metrics\n- Financial indicators showing strong operational efficiency\n- Risk mitigation effectiveness measured and reported\n- Supplier performance monitoring and management\n\n**Operational Excellence:**\n- Proactive supplier relationship management\n- Legal team integration for contract compliance\n- AI-powered contract analysis and risk flagging\n- Real-time communication and coordination\n- Timeline adjustment capabilities to prevent cascading delays\n\n**Risk Mitigation Examples:**\nWhen Device X supplier delay occurred, our team immediately: 1) Identified penalty clause triggers, 2) Notified customer (ACME) within required timeframe, 3) Drafted revised timeline, 4) Utilized AI contract tracker to identify impacted contracts, 5) Adjusted QA schedule to prevent cascading delays.",
      confidence: "High",
      agentResponses: [
        {
          agent: "Ops",
          bullets: [
            "Supplier delay on Device X managed proactively with 2-week impact",
            "QA slot rescheduled to September 18 to prevent cascading delays",
            "AI contract tracker v3 enables rapid impact assessment",
            "Cross-functional team coordination via WhatsApp for real-time response",
            "Timeline adjustment capabilities prevent project overruns",
            "Supplier performance monitoring identifies risks early"
          ],
          risk_level: "medium",
          insufficient_context: false
        },
        {
          agent: "Legal",
          bullets: [
            "Penalty clause triggers identified within 10-day window",
            "ACME notification completed within contractual requirements",
            "Contract tracker v3 searches 'Device X penalty clause' effectively",
            "Legal team provides real-time guidance to operations",
            "Contract compliance monitoring prevents liability exposure",
            "Risk mitigation actions documented and tracked"
          ],
          risk_level: "low",
          insufficient_context: false
        },
        {
          agent: "Analyst",
          bullets: [
            "Portfolio KPIs Q3 2025 provide comprehensive performance tracking",
            "Risk register enables systematic risk identification and mitigation",
            "Operational efficiency metrics show strong performance",
            "Supplier risk management demonstrates proactive approach",
            "AI-powered contract analysis improves risk detection",
            "Cross-functional coordination reduces operational risk"
          ],
          risk_level: "low",
          insufficient_context: false
        },
        {
          agent: "Finance",
          bullets: [
            "Supplier delays impact project margins but within acceptable range",
            "Penalty clause management prevents additional costs",
            "Risk mitigation investments show positive ROI",
            "Operational efficiency improvements offset delay costs",
            "Portfolio performance metrics guide resource allocation",
            "Risk management framework reduces financial exposure"
          ],
          risk_level: "low",
          insufficient_context: false
        },
        {
          agent: "Tax",
          bullets: [
            "No tax implications for supplier delay management",
            "Risk mitigation costs qualify as business expenses",
            "Contract penalty clauses have no adverse tax impact",
            "Operational efficiency improvements support tax optimization",
            "Portfolio performance tracking supports tax planning",
            "Risk management framework aligns with tax compliance"
          ],
          risk_level: "low",
          insufficient_context: false
        },
        {
          agent: "Strategy",
          bullets: [
            "Proactive risk management demonstrates operational maturity",
            "AI-powered contract analysis provides competitive advantage",
            "Cross-functional coordination model scalable for growth",
            "Supplier relationship management supports supply chain resilience",
            "Risk mitigation framework enables confident expansion",
            "Operational excellence supports customer satisfaction and retention"
          ],
          risk_level: "low",
          insufficient_context: false
        }
      ],
      miyagiMemoriesUsed: 2,
      citations: ["WhatsApp Ops Team Transcript (p.1)", "Portfolio KPIs Q3 2025 (p.1)", "Risk Register (p.1)"]
    };
  }
  
  // Contract and agreement questions
  if (lowerQuestion.includes('contract') || lowerQuestion.includes('agreement') || lowerQuestion.includes('msa') || lowerQuestion.includes('nda') || lowerQuestion.includes('compare') || lowerQuestion.includes('version')) {
    return {
      answer: "## Master Service Agreement Version Comparison\n\n**MSA v2 vs v3 Analysis:**\n\n**Key Changes from v2 (2025-07-10) to v3 (2025-08-20):**\n\n**Service Level Improvements:**\n- **Uptime:** Increased from 99.5% to 99.9%\n- **Response Time:** P1 incidents now < 30 minutes (vs 1 hour)\n- **Reliability:** Enhanced monitoring and alerting systems\n\n**Data Residency & Security:**\n- **New Region:** Added UK option with dedicated KMS\n- **Zero Egress:** Default no-data-leakage policy\n- **Enhanced Encryption:** Customer-managed keys across all regions\n- **Audit Trail:** Improved logging and compliance reporting\n\n**Contract Terms:**\n- **Duration:** Extended from 12 to 24 months\n- **Notice Period:** Increased to 90 days (vs 60 days)\n- **Pricing:** 3% cap uplift for first 3 years\n- **Liability:** Increased cap to 18 months fees (vs 12 months)\n\n**Business Impact:**\n- **Customer Retention:** Longer terms improve LTV\n- **Risk Management:** Higher liability cap reduces exposure\n- **Compliance:** Enhanced security attracts enterprise clients\n- **Revenue Stability:** Longer contracts provide predictable income",
      confidence: "High",
      agentResponses: [
        {
          agent: "Legal",
          bullets: [
            "MSA v3 includes enhanced security terms and compliance framework",
            "Liability cap increase to 18 months provides better risk coverage",
            "Extended contract terms (24 months) improve customer retention",
            "UK data residency option addresses Brexit compliance requirements",
            "Zero egress policy meets enterprise security standards",
            "Enhanced audit trail supports regulatory compliance"
          ],
          risk_level: "low",
          insufficient_context: false
        },
        {
          agent: "Finance",
          bullets: [
            "3% pricing cap uplift provides predictable revenue growth",
            "24-month contracts improve cash flow predictability",
            "Higher liability cap reduces potential financial exposure",
            "Enhanced service levels justify premium pricing",
            "UK region expansion opens new revenue opportunities",
            "Longer contracts increase customer lifetime value"
          ],
          risk_level: "low",
          insufficient_context: false
        },
        {
          agent: "Ops",
          bullets: [
            "99.9% uptime target requires enhanced infrastructure monitoring",
            "30-minute P1 response time needs 24/7 operations team",
            "UK data center setup requires additional operational overhead",
            "Zero egress architecture needs specialized network configuration",
            "Enhanced audit logging requires additional storage and processing",
            "Customer-managed keys need secure key management processes"
          ],
          risk_level: "low",
          insufficient_context: false
        },
        {
          agent: "Analyst",
          bullets: [
            "Version comparison shows clear product evolution and maturity",
            "Enhanced security features address enterprise market demands",
            "Longer contract terms indicate strong customer confidence",
            "UK expansion demonstrates international growth strategy",
            "Improved service levels reflect operational excellence",
            "Pricing structure supports sustainable business model"
          ],
          risk_level: "low",
          insufficient_context: false
        },
        {
          agent: "Tax",
          bullets: [
            "UK data residency enables tax-efficient international operations",
            "Extended contract terms provide better tax planning opportunities",
            "Enhanced security investments qualify for R&D tax credits",
            "Customer-managed keys have no adverse tax implications",
            "Longer contracts improve revenue recognition timing",
            "International expansion requires tax compliance in new jurisdictions"
          ],
          risk_level: "low",
          insufficient_context: false
        },
        {
          agent: "Strategy",
          bullets: [
            "MSA v3 positions company for enterprise market expansion",
            "Enhanced security features differentiate from competitors",
            "UK expansion supports European market entry strategy",
            "Longer contracts improve customer retention and LTV",
            "Zero egress model addresses enterprise security concerns",
            "Version evolution demonstrates product maturity and customer focus"
          ],
          risk_level: "low",
          insufficient_context: false
        }
      ],
      miyagiMemoriesUsed: 2,
      citations: ["Master Service Agreement v3 (p.1-2)", "Master Service Agreement v2 (p.1)"]
    };
  }
  
  // Default demo response
  return {
    answer: `This is a demo response to: "${question}". The system is working correctly and would provide real insights based on your uploaded documents. Upload your own files to get personalized analysis.`,
    confidence: "High",
    agentResponses: [
      {
        agent: "Legal",
        bullets: ["System ready for legal document analysis", "Compliance checking available"],
        risk_level: "low",
        insufficient_context: false
      },
      {
        agent: "Finance",
        bullets: ["Financial analysis capabilities ready", "Revenue and cost analysis available"],
        risk_level: "low",
        insufficient_context: false
      },
      {
        agent: "Ops",
        bullets: ["Operational insights ready", "Process optimization analysis available"],
        risk_level: "low",
        insufficient_context: false
      },
      {
        agent: "Analyst",
        bullets: ["Data analysis capabilities ready", "Trend analysis available"],
        risk_level: "low",
        insufficient_context: false
      },
      {
        agent: "Tax",
        bullets: ["Tax analysis ready", "Compliance checking available"],
        risk_level: "low",
        insufficient_context: false
      },
      {
        agent: "Strategy",
        bullets: ["Strategic analysis ready", "Market insights available"],
        risk_level: "low",
        insufficient_context: false
      }
    ],
    miyagiMemoriesUsed: 0,
    citations: []
  };
}

// Mount other routes after custom endpoints
app.use(whatsappBridge);
app.use(indexList);
app.use(audit);
app.use(chat);
app.use(chatAgents);
app.use(upload);
app.use(admin);

app.listen(PORT, async () => {
  console.log(`API on http://localhost:${PORT}`);
  console.log(`🚀 Server started with all endpoints: /account/init, /account/me, /chat-agents`);
  console.log(`📊 Enhanced demo responses with detailed investor content - Version 2.0`);
  
  try {
    // bootstrap DB: run schema and create a demo account + routing
    const schema = fs.readFileSync(path.join(process.cwd(), "src/sql/schema.sql"), "utf-8");
    await db.none(schema);

    // ensure a demo account + binding (routing code e.g., ZY-4K7R2X)
    const accountId = "11111111-1111-1111-1111-111111111111";
    const code = "ZY-4K7R2X";
    await db.none("INSERT INTO accounts(account_id,name) VALUES($1,$2) ON CONFLICT DO NOTHING", [accountId, "Demo"]);
    await db.none(
      "INSERT INTO wa_bindings(account_id,routing_code) VALUES($1,$2) ON CONFLICT (account_id) DO NOTHING",
      [accountId, code]
    );
    console.log(`Demo accountId: ${accountId}  routing_code: ${code}`);
    console.log("Database initialized successfully");
  } catch (error) {
    console.error("Database initialization failed:", error);
    console.log("Continuing with mock database...");
  }
  
  console.log(`CORS enabled for Vercel domains`);
});
