# קליטת CSV ב־NiFi

הפעילו את פרופיל הייבוא באמצעות `docker compose --profile import up --build -d`. התחברו ל־[NiFi](https://localhost:8443/nifi) עם `permitflow` ו־`permitflow-nifi-demo`. ‏Compose מפעיל את NiFi עם תעודה מקומית ותיקיות לנתוני הדמו.

## חיבור הזרימה על הקנבס

```text
ListFile → FetchFile → ExecuteScript → PublishKafka
                                    ↘ PutFile (rejected)
```

1. הגדירו ב־**ListFile** את `Input Directory` ל־`/opt/permitflow/import/inbox`, את `File Filter` ל־`.*\.csv` ואת `Recurse Subdirectories` ל־`false`. השתמשו ב־`Tracking Timestamps` לשמירת מיקום הסריקה לפי מצב המעבד.
2. חברו את `success` ל־**FetchFile**. הגדירו `File to Fetch` ל־`${absolute.path}/${filename}` ו־`Completion Strategy` ל־`None`.
3. חברו את `success` ל־**ExecuteScript**. בחרו `Groovy` והגדירו `Script File` ל־`/opt/permitflow/normalize.groovy`. הסקריפט מקבל קובץ UTF-8 עד 64 KiB עם כותרת `id,purpose,days` ושדות פשוטים ללא מירכאות. הוא מנרמל רווחים ורישיות ומאמת UUID, מטרה ומשך.
4. חברו את `success` של הסקריפט ל־**PublishKafka**. צרו והפעילו `Kafka3ConnectionService` עם `Bootstrap Servers` בערך `kafka:9092` ו־`Security Protocol` בערך `PLAINTEXT`. ב־**PublishKafka** חברו את השירות ובחרו בנושא `permitflow.csv-import`. השתמשו בתוכן ה־FlowFile בתור ההודעה וב־`${filename}` כמפתח. סיימו אוטומטית את `success`.
5. חברו את `failure` של הסקריפט ל־**PutFile** עם `Directory` בערך `/opt/permitflow/import/rejected` ו־`Conflict Resolution Strategy` בערך `replace`. סיימו אוטומטית את `success`.
6. כדי לשמור כשלים תפעוליים לבדיקה, חברו יחסי שגיאה של FetchFile, PublishKafka ו־PutFile ל־**Funnel** נפרד והשאירו את התורים זמינים לבדיקה על הקנבס. הפעילו את המעבדים.

העתיקו את [sample.csv](sample.csv) ל־`demo/import/inbox` אחרי שהזרימה פעילה. שתי שורות תקינות יופיעו בחשבון המבקש, ושתי דחיות יופיעו כ־JSON בתיקיית `rejected`. כל דחייה כוללת קוד סיבה ואת מספר השורה, כשיש מספר שורה. שורות תקינות עם אותו UUID יוצרות בקשה יחידה גם אם הקובץ הוזן מחדש. במצב NiFi השמור, אותו קובץ ללא שינוי מסונן כבר ב־ListFile. בקליטה חוזרת אחרי איפוס מצב או החלפת שם, מזהה השורה וקבלת הייבוא ב־PostgreSQL מונעים יצירה כפולה. טביעת SHA-256 מתעדת את הקובץ המקורי.

[תיעוד ExecuteScript](https://nifi.apache.org/components/org.apache.nifi.processors.script.ExecuteScript/) · [תיעוד PublishKafka](https://nifi.apache.org/components/org.apache.nifi.kafka.processors.PublishKafka/)
