# Q4 — قابلية التوسع وتوزيع الأحمال

## 1. Architecture Diagram

راجع الملف `architecture.png` في هذا المجلد.

يوضّح المخطط تدفّق **15,000 req/s** عبر:

| الطبقة | المكوّن | الدور |
|--------|---------|-------|
| Edge | Ghaymah Load Balancer (L7) | توزيع الطلبات، SSL، Health Checks |
| Compute | Auto Scaling Group — 43 حاوية | معالجة الطلبات (500 req/s لكل حاوية) |
| Stateful | Ghaymah Block Storage | تخزين دائم للـ stateful workloads |
| Cache/CDN | Object Storage / CDN | الملفات الثابتة والوسائط |
| Ops | Monitoring & Alerts | مقاييس، تنبيهات، قرارات التوسع |
| Warm Pool | Cold Start Pool | حاويات مُسخَّنة مسبقاً لتقليل زمن الإقلاع |

---

## 2. حساب عدد الحاويات

### المعطيات

| المتغير | القيمة |
|---------|--------|
| إجمالي الحمل | **15,000 req/s** |
| سعة الحاوية الواحدة | **500 req/s** |
| هامش الأمان | **30%** |

### المنطق

الهامش 30% يعني **عدم تشغيل الحاويات فوق 70%** من سعتها القصوى، لترك مساحة للذروات والتقلبات:

```
السعة الفعلية القابلة للتخطيط = 500 × (1 − 0.30) = 500 × 0.70 = 350 req/s لكل حاوية
```

### الحساب

```
عدد الحاويات = ⌈ 15,000 ÷ 350 ⌉
             = ⌈ 42.857 ⌉
             = 43 حاوية
```

### التحقق

```
43 × 350 = 15,050 req/s  ✅ (يغطي 15,000 req/s مع هامش 30%)
```

### ملخص

| البند | القيمة |
|-------|--------|
| الحد الأدنى نظرياً (بدون هامش) | 30 حاوية |
| **العدد الموصى به (مع هامش 30%)** | **43 حاوية** |
| السعة الإجمالية الفعلية | 15,050 req/s |
| نسبة الاستخدام عند 15K req/s | ≈ 99.7% من السعة المُخطَّطة |

> **ملاحظة:** إذا قصدت إضافة 30% فوق العدد الأساسي: `30 × 1.30 = 39 حاوية`.  
> في سياق SRE، هامش السعة (capacity headroom) هو التفسير الأدق — أي 43 حاوية.

---

## 3. استراتيجية Cold Start للحاويات الجديدة

عند التوسع الأفقي (scale-out)، الحاوية الجديدة تحتاج وقتاً قبل أن تستقبل حركة. الاستراتيجية المقترحة:

### أ) Warm Pool (مجموعة تسخين)

- الإبقاء على **3–5 حاويات جاهزة** في حالة `standby` (مُشغَّلة ومُسخَّنة، لكن خارج rotation الـ Load Balancer).
- عند ارتفاع الحمل، تُضاف فوراً إلى الـ LB **بدون** انتظار pull للصورة أو boot.

### ب) Pre-pull الصور

- تخزين صورة Docker في **Ghaymah Internal Registry** داخل نفس المنطقة.
- تقليل زمن `image pull` من دقائق إلى ثوانٍ.

### ج) Readiness Probe تدريجي

```
Startup Probe  →  Readiness Probe  →  إضافة للـ LB
     (30s)              (HTTP /health)
```

- لا تُوجَّه الطلبات للحاوية حتى تمر `/health` بنجاح.
- يمنع إرسال حركة لحاوية لم تكتمل تهيئتها.

### د) Graceful Scale-In

- عند التقليص: إرسال `SIGTERM` → انتظار إنهاء الطلبات الجارية (drain) → إزالة من LB → إيقاف.
- يمنع قطع الطلبات أثناء التوسع العكسي.

### هـ) Predictive Scaling

- مراقبة CPU / RPS / latency.
- بدء التوسع **قبل** الوصول للحد (مثلاً عند 60% utilization) وليس عند 90%.

### ف) Application Warm-up

- عند الإقلاع: تحميل cache محلي، pre-connect لقاعدة البيانات، JIT warm-up.
- endpoint `/warmup` يُستدعى تلقائياً بعد readiness.

---

## 4. Ghaymah Block Storage للـ Stateful Workloads

### ما هو Block Storage؟

تخزين **كتلة (block-level)** يُ attach كقرص افتراضي (volume) لحاوية أو خدمة — مثل `/dev/vdb` — ويحتفظ بالبيانات **بعد** إعادة تشغيل أو استبدال الحاوية.

### متى نستخدمه؟

| Stateful | Stateless (لا يحتاج Block Storage) |
|----------|-------------------------------------|
| PostgreSQL / MySQL | API servers (43 حاوية أعلاه) |
| Redis persistence (AOF/RDB) | Static assets → Object Storage |
| File uploads / media processing | Session في Redis مشترك |
| Logs طويلة الأمد | |

### كيف يُستخدم على غيمة؟

1. **إنشاء Volume**  
   - حجم مناسب (مثلاً 100 GB SSD) في نفس منطقة التطبيق.

2. **Mount على الحاوية Stateful**  
   ```text
   /data/postgresql  ←  Ghaymah Block Volume (persistent)
   ```

3. **فصل Compute عن Storage**  
   - حاويات الـ API **stateless** — تتوسع أفقياً بحرية.
   - قاعدة البيانات **stateful** — volume واحد (أو cluster مع replication).

4. **Snapshots & Backup**  
   - Ghaymah Backup: snapshots دورية للـ volume.
   - استرداد Point-in-Time عند الفشل.

5. **High Availability**  
   - Primary DB على volume + Replica على volume منفصل.
   - Failover تلقائي عند سقوط Primary.

### في مخططنا (architecture.png)

```
Load Balancer → 43 App Containers (stateless)
                      ↓
              Stateful DB Pod ← Ghaymah Block Storage (persistent volume)
```

- الـ **43 حاوية** لا تخزّن state محلياً.
- كل البيانات الدائمة على **Block Storage** م attached لطبقة DB/Cache الم persistent.

### الفوائد

| الفائدة | الشرح |
|---------|--------|
| Persistence | البيانات تبقى بعد restart/redeploy |
| Performance | IOPS مضمون لقواعد البيانات |
| Scalability | فصل التوسع الأفقي (API) عن التخزين (DB) |
| DR | Snapshots + restore سريع |

---

## المراجع

- [Ghaymah Cloud](https://ghaymah.systems/)
- [Ghaymah CLI — `gy resource app launch`](https://cli.ghaymah.systems/)
- Health & Retry: HTTP/TCP probes — down-nodes تخرج فوراً من rotation
