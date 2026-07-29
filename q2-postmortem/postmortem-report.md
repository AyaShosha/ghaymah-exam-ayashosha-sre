# Q2 — تحليل حادثة انقطاع (Postmortem)

**التاريخ:** 28 يوليو 2026  
**المدة:** 45 دقيقة  
**الخدمة:** تطبيق Node.js على غيمة (`nodeapp-production`)  
**التأثير:** انقطاع كامل عن المستخدمين — HTTP 502/503  
**السبب المباشر:** OOMKilled متكرر (نفاد الذاكرة)

---

## 1. الملخص التنفيذي

في 28 يوليو 2026، تعطّل تطبيق الإنتاج على **Ghaymah Cloud** لمدة **45 دقيقة** بسبب قتل الحاويات المتكرر من نوع **OOMKilled**.  
ارتفع استهلاك الذاكرة تدريجياً بعد نشر إصدار جديد، حتى تجاوز الحد المخصص للحاوية (`512 MiB` — فئة `t1`).  
بدأت الحاويات في الدورة: تشغيل → امتلاء الذاكرة → OOMKill → إعادة تشغيل، مما جعل **Health Probes** تفشل وخرجت جميع النسخ من **Load Balancer**.

**السبب الجذري:** حد ذاكرة غير كافٍ + تسريب ذاكرة (memory leak) في middleware جديد + غياب تنبيهات مبكرة و auto-scaling.

**الإجراء الفوري:** رفع حجم الحاوية إلى `ρ-l` (1 GiB) وزيادة `count` من 2 إلى 4، ثم rollback للإصدار السابق.

---

## 2. Timeline

| الوقت (UTC+3) | الحدث |
|---------------|--------|
| 14:00 | حركة طبيعية — 2 حاويات، استهلاك ذاكرة ~55% |
| 14:12 | نشر إصدار `v1.4.2` (rolling deploy) |
| 14:18 | الذاكرة ترتفع إلى ~78% على الحاويات الجديدة |
| 14:22 | **أول OOMKill** — الحاوية `pod-7f3a` تُقتل من Kernel |
| 14:24 | إعادة تشغيل تلقائية — Health probe يفشل لـ 30 ثانية |
| 14:26 | OOMKill ثاني — بدء **restart loop** |
| 14:30 | LB يزيل كل الحاويات من rotation — **بداية الانقطاع الكامل** |
| 14:35 | تنبيه uptime يرسل (تأخر 13 دقيقة عن أول OOMKill) |
| 14:40 | مهندس on-call يراجع logs — يجد `OOMKilled` و `Exit Code 137` |
| 14:42 | rollback إلى `v1.4.1` + رفع `size` إلى `ρ-l` |
| 14:45 | Health probes تنجح — **استعادة الخدمة** |

**MTTR:** 45 دقيقة  
**MTTD (Mean Time To Detect):** ~13 دقيقة (بطيء)

---

## 3. Root Cause Analysis

### 3.1 السبب المباشر (Immediate Cause)

Linux Kernel قتل عملية الحاوية لأنها تجاوزت **memory limit** المحدد في `.ghaymah.json`:

```json
"resourceTier": "t1"   // 512 MiB RAM
```

رسالة النظام:

```text
State: OOMKilled
Exit Code: 137
Reason: Memory limit exceeded
```

### 3.2 السبب الجذري (Root Cause)

| # | السبب | التفصيل |
|---|--------|---------|
| 1 | **حد ذاكرة منخفض** | `t1` (512 MiB) غير مناسب لحمل الإنتاج بعد النشر الجديد |
| 2 | **Memory leak** | middleware logging في `v1.4.2` يخزّن request bodies في array بدون حد أقصى |
| 3 | **لا auto-scaling** | `count: 2` ثابت — لم يُضف حاويات عند ارتفاع الحمل |
| 4 | **تنبيهات متأخرة** | لا يوجد alert على memory > 80% أو restart count |

### 3.3 العوامل المساهمة

- لم يُجرَ load test على `v1.4.2` قبل الإنتاج
- Rolling deploy أبقى 20% من الحاويات القديمة لكن الجديدة consumptive أكثر
- لا مراقبة لـ `container_restart_count`

---

## 4. التوصيات (Action Items)

| # | الإجراء | الأولوية | المسؤول | الحالة |
|---|---------|----------|---------|--------|
| 1 | إصلاح memory leak في middleware | P0 | Backend | ✅ تم |
| 2 | رفع الحد الأدنى للذاكرة إلى `ρ` (768 MiB) | P0 | SRE | ✅ تم |
| 3 | تفعيل auto-scaling (انظر القسم 2 أدناه) | P1 | SRE | 🔄 قيد التنفيذ |
| 4 | تنبيه RasidAI عند memory > 80% لـ 2 دقيقة | P1 | SRE | 🔄 قيد التنفيذ |
| 5 | تنبيه عند `restart_count > 3` في 10 دقائق | P1 | SRE | 📋 مخطط |
| 6 | load test إلزامي قبل deploy لـ main | P2 | DevOps | 📋 مخطط |
| 7 | إضافة `/health` يفحص memory usage | P2 | Backend | 📋 مخطط |

---

## 5. سياسة Auto-Scaling لمنصة غيمة

غيمة توفر مفتاحين رئيسيين في `.ghaymah.json`:

- **`count:`** — عدد النسخ (Horizontal Scaling)
- **`size:`** — فئة CPU/RAM: `ρ`, `ρ-m`, `ρ-l`, `ρ-xl` (Vertical Scaling)

### 5.1 Horizontal Pod Scaling (HPA)

```
زِد count عندما:
  - متوسط CPU > 70% لمدة 3 دقائق، أو
  - متوسط Memory > 75% لمدة 3 دقائق، أو
  - p95 latency > 800ms لمدة 5 دقائق

قلّل count عندما:
  - CPU < 30% AND Memory < 40% لمدة 10 دقائق

الحدود:
  - min_count: 2
  - max_count: 10
  - scale_up_cooldown: 60s
  - scale_down_cooldown: 300s
```

**مثال في `.ghaymah.json`:**

```json
{
  "count": 2,
  "autoscaling": {
    "enabled": true,
    "min": 2,
    "max": 10,
    "metrics": [
      { "type": "memory", "target": 75, "duration": "3m" },
      { "type": "cpu", "target": 70, "duration": "3m" }
    ]
  }
}
```

### 5.2 Vertical Scaling (VPA-lite)

```
ارفع size عندما:
  - Memory > 85% على ALL instances لمدة 5 دقائق
  - OOMKill حدث مرة واحدة على الأقل

مسار الترقية:
  t1 (512 MiB) → ρ (768 MiB) → ρ-l (1 GiB) → ρ-xl (2 GiB)

لا تُخفِض size تلقائياً — يدوي فقط بعد مراجعة 7 أيام
```

### 5.3 سياسة منع OOMKilled

```
1. memory_limit = observed_peak × 1.3 (هامش 30%)
2. إذا restart_count > 2 في 5 min → scale up فوراً (count +1 أو size +1)
3. rolling deploy: لا تزيد أكثر من 50% من الحاويات دفعة واحدة
4. Graceful shutdown: SIGTERM grace period = 30s قبل SIGKILL
```

### 5.4 Flowchart

```text
Memory > 75% لـ 3 min?
  ├─ نعم → count + 1 (حتى max)
  └─ لا → استمر

OOMKill detected?
  ├─ نعم → size + 1 فوراً + alert P0
  └─ لا → استمر

Memory > 85% على كل instances?
  ├─ نعم → size + 1
  └─ لا → OK
```

---

## 6. الكشف المبكر — أدوات مراقبة غيمة

### 6.1 RasidAI Monitoring

- مراقبة real-time للتطبيقات على غيمة
- **تنبيهات مقترحة:**
  - Memory utilization > **80%** لمدة 2 دقيقة → Warning
  - Memory utilization > **90%** لمدة 1 دقيقة → Critical
  - Container restart > **3** في 10 دقائق → Critical
  - Health probe failures > **2** متتالية → Critical

### 6.2 Logs (JSON — 30 يوم retention)

```bash
gy logs app nodeapp-production --env production --follow
```

**ما نبحث عنه:**

```text
OOMKilled
Exit code 137
FATAL ERROR: Reached heap limit
JavaScript heap out of memory
```

- كل log يحتوي **trace-id** — نربط الطلبات قبل الانهيار
- Dashboard في RasidAI: رسم memory usage vs limit over time

### 6.3 Health & Retry Probes

غيمة تدعم HTTP/TCP probes:

```json
"healthCheck": {
  "path": "/health",
  "interval": 10,
  "timeout": 5,
  "unhealthyThreshold": 2
}
```

**تحسين `/health`:**

```javascript
app.get('/health', (req, res) => {
  const used = process.memoryUsage().heapUsed / 1024 / 1024
  if (used > 400) return res.status(503).json({ status: 'degraded', memory_mb: used })
  res.json({ status: 'ok', memory_mb: used })
})
```

→ الحاوية تخرج من LB **قبل** OOMKill

### 6.4 CLI — فحص سريع

```bash
gy resource app status --env production
gy resource app logs --env production --tail 100
```

### 6.5 لوحة مراقبة (Dashboard)

| Metric | Threshold Warning | Threshold Critical |
|--------|-------------------|---------------------|
| Memory % | 80% | 90% |
| CPU % | 70% | 85% |
| Restart count / 10min | 1 | 3 |
| p95 latency | 500ms | 1000ms |
| Error rate (5xx) | 1% | 5% |

### 6.6 كيف كان يمكن اكتشافها قبل الانقطاع؟

```text
14:18  Memory 78%  → ⚠️ Warning alert (كان سيُرسل)
14:20  Memory 85%  → 🔴 Critical alert
14:22  OOMKill      → 🔴 Auto scale-up + P0 page
14:30  Outage       → ❌ لم يحدث (في الواقع)
```

**الفجوة:** لم تكن التنبيهات مفعّلة → **MTTD 13 دقيقة بدلاً من 2 دقيقة**.

---

## 7. الدروس المستفادة

1. **OOMKilled = Exit 137** — أول شيء نفحصه في logs بعد أي restart غير متوقع
2. حد الذاكرة يجب أن يُحسب من **P99 + 30%** وليس من التقدير
3. Auto-scaling أفقي **و** عمودي معاً — HPA وحده لا يكفي إذا leak في كل instance
4. Health endpoint يجب أن يفحص **memory** وليس `return 200` فقط
5. RasidAI + alerts = MTTD أقل من 5 دقائق → يمنع 45 دقيقة outage

---

## 8. المراجع

- [Ghaymah Cloud — التوسع التلقائي](https://ghaymah.systems/)
- Ghaymah Programs Features — `count:`, `size:`, Health Probes, RasidAI
- SLA غيمة: 99.9% uptime per region
