1. اكتب تقرير Postmortem (ملخص + timeline + root cause + توصيات)
- الملخص : تطبيق على غيمة تعطّل 45 دقيقة بسبب OOMKilled متكرر.
  **التاثير :
  التطبيق أصبح غير متاح للمستخدمين لمدة 45 دقيقة.
جميع الطلبات (Requests) فشلت أثناء فترة الانقطاع.
أثر ذلك على تجربة المستخدم وتوفر الخدمة (Service Availability).
** الحل :
  تم إعادة تشغيل الـ Pods، وزيادة حدود الذاكرة (Memory Limits)، وتحسين إعدادات الـ Kubernetes لمنع تكرار المشكلة.
  - root cause :
    السبب الرئيسي

الـ Application استهلك ذاكرة أكبر من الحد المحدد داخل الـ Kubernetes.

عندما تجاوز الاستهلاك الـ Memory Limit قام Linux Kernel بتفعيل OOM Killer، فقام Kubernetes بإنهاء الـ Container وإعادة تشغيله.

وبسبب استمرار الحمل المرتفع تكرر نفس السيناريو عدة مرات، مما أدى إلى انقطاع الخدمة.

العوامل المساعدة
Memory Limits منخفضة.   
عدم وجود Horizontal Pod Autoscaler.
عدم وجود مراقبة استباقية لاستهلاك الذاكرة.
عدم وجود Alerts قبل الوصول للحد الأقصى.
الحمل المفاجئ لم يكن متوقعًا.
- timeline :
  Time	Event
10:00 AM	زيادة مفاجئة في عدد المستخدمين والطلبات.
10:05 AM	استهلاك الذاكرة بدأ يقترب من الحد الأقصى.
10:10 AM	أول Pod تعرض لـ OOMKilled.
10:15 AM	Kubernetes أعاد تشغيل الـ Pod ولكن المشكلة استمرت.
10:20 AM	عدة Pods دخلت في CrashLoop بسبب تكرار OOMKilled.
10:25 AM	المستخدمون بدأوا يواجهون أخطاء وعدم استجابة التطبيق.
10:35 AM	فريق التشغيل بدأ التحقيق في المشكلة.
10:45 AM	زيادة Memory Limits وتشغيل Pods جديدة.
10:45–10:50 AM	الخدمة عادت للعمل بصورة طبيعية.

-توصيات : 
**Short-term : 
زيادة Memory Limits.
مراجعة Memory Requests.
إعادة تشغيل Pods المتأثرة.
مراجعة Logs للتأكد من عدم وجود Memory Leak.
**Long-term : 
تفعيل Horizontal Pod Autoscaler (HPA).
استخدام Cluster Autoscaler إذا امتلأت الـ Nodes.
إضافة Prometheus وGrafana للمراقبة.
إنشاء Alerts عند وصول استهلاك الذاكرة إلى 80%.
إجراء Load Testing قبل نشر الإصدارات الجديدة.
تحسين كفاءة التطبيق وتقليل استهلاك الذاكرة.



---------------------------------------------------------------------------------------------------------------------------------------

2. صمم سياسة auto-scaling لمنصة غيمة تمنع التكرار :
لمنع تكرار المشكلة يتم استخدام Horizontal Pod Autoscaler (HPA).

السياسة المقترحة
Minimum Replicas: 2
Maximum Replicas: 10
Target CPU Utilization: 70%
Target Memory Utilization: 75%

عند زيادة الحمل يقوم Kubernetes بإنشاء Pods جديدة تلقائيًا لتوزيع الطلبات، وعند انخفاض الحمل يقلل عدد الـ Pods لتوفير الموارد.

وإذا لم تعد موارد الـ Nodes كافية، يتم استخدام Cluster Autoscaler لإضافة Nodes جديدة تلقائيًا.
------------------------------------------------------------------------------------------------------------------------------------------------


3. اشرح كيف تكشف هذه المشكلة مبكراً باستخدام أدوات مراقبة غيمة :
يمكن اكتشاف المشكلة مبكرًا باستخدام أدوات المراقبة التالية:

Prometheus

يجمع Metrics مثل:

Memory Usage
CPU Usage
Container Restarts
OOMKilled Events
Pod Status
Grafana

تعرض Dashboard تحتوي على:

استهلاك الذاكرة.
استخدام المعالج.
عدد الـ Pods.
عدد مرات إعادة التشغيل.
Response Time.
Error Rate.
Alerting

يتم إرسال Alert عندما:

Memory Usage > 80%
عدد Restarts أكبر من 3 خلال 5 دقائق.
ظهور حدث OOMKilled.
أحد الـ Pods يدخل CrashLoopBackOff.
Availability أقل من 99%.

يمكن إرسال التنبيهات عبر:

Email
Slack
Microsoft Teams
 
