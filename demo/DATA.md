# לוגים ומסדי נתונים ב־PermitFlow

הריצו את הפקודות מתיקיית המאגר כשהמערכת פעילה. שימו לב למזהה הבקשה שמופיע בפרטי הבקשה. הוא מאפשר לקשר בין התצוגה, SQL, הלוגים והאירועים.

## מעקב אחרי בקשה

```powershell
docker compose logs --tail=100 -f api
```

- `Application status saved` מופיע אחרי ש־PostgreSQL אישר את הטרנזקציה. הוא מראה את מזהה הבקשה, הסטטוס והחשבון שביצע את הפעולה.
- `Kafka acknowledged` מופיע כשהברוקר מאשר אירוע. הלוג כולל מזהי בקשה ואירוע, נושא, מחיצה ומיקום.
- `Audit stored` מופיע אחרי כתיבת האירוע ל־MongoDB.

אפשר לעצור את המעקב עם Ctrl+C. לוגי הברוקר זמינים דרך `docker compose logs --tail=100 kafka`.

## PostgreSQL

```powershell
docker compose exec postgres psql -U permitflow -d permitflow
```

ב־`psql` הקלידו:

```sql
\dt public.*
\d public.applications
SELECT id, purpose, status, created_at FROM public.applications ORDER BY created_at DESC LIMIT 10;
SELECT sequence, event_id, application_id, event_type, occurred_at, published_at
FROM public.outbox ORDER BY sequence DESC LIMIT 15;
\q
```

`permitflow` הוא מסד הנתונים. `public` הוא מרחב השמות (schema) שבו נמצאות הטבלאות. Flyway מנהל את מבנה הנתונים דרך [המיגרציות](../backend/src/main/resources/db/migration).

| טבלה | למה היא קיימת |
| --- | --- |
| `applicants` | מזהה כל מבקש. המפתח הזר בבקשה קושר אותה למבקש קיים. |
| `applications` | הרשומה המרכזית של בקשה. מכילה מבקש, מטרה, מועדים, סטטוס ומפתח להגשה חוזרת. |
| `application_history` | כל מעבר סטטוס עם הזמן והחשבון שביצע אותו. ממנו בנוי ציר הזמן. |
| `decisions` | שומרת את החלטת האישור או הדחייה ומי קיבל אותה. ההפרדה משמרת את ההחלטה גם לאחר הנפקה. |
| `permits` | שומרת מזהה היתר, מנפיק ומועד תפוגה. אילוץ ייחוד מאפשר היתר אחד לכל בקשה. |
| `application_documents` | מטא־דאטה של מסמכים, כולל שם, סוג, גודל ו־SHA-256. תוכן המסמך נשמר ב־MinIO. |
| `outbox` | אירועים שממתינים לפרסום או שפורסמו. הרשומה נכתבת באותה טרנזקציה כמו השינוי בעסק. |
| `import_receipts` | קבלה לכל שורת CSV שנקלטה, כדי לזהות מסירה חוזרת. |
| `flyway_schema_history` | מצב המיגרציות שכבר הוחלו על מסד הנתונים. |

## מה מפרסם ל־Kafka

ב־[`Outbox.publishNext()`](../backend/src/main/java/dev/permitflow/events/Outbox.java) יש `@Scheduled(fixedDelay = 1500)`. המתזמן מחכה 1.5 שניות מסיום ניסיון אחד לפני הבא. בכל ניסיון הוא בוחר את הרשומה הממתינה הבאה, מפרסם ל־`permitflow.application-events`, ומעדכן `published_at` אחרי אישור Kafka. ערך `NULL` מציין שהפרסום טרם סומן. עצירה בין אישור Kafka לעדכון המסד עלולה לגרום למשלוח חוזר, ולכן הצרכן מזהה כפילויות לפי מזהה האירוע.

## MongoDB

```powershell
docker compose exec mongo mongosh permitflow
```

```javascript
show collections
db.application_events.find({}, { applicationId: 1, eventType: 1, status: 1, occurredAt: 1 }).sort({ occurredAt: -1 }).limit(10).toArray()
exit
```

`application_events` הוא אוסף יומן הביקורת. כל מסמך מייצג אירוע Kafka, ו־`_id` הוא מזהה האירוע. PostgreSQL מחזיק את המצב העסקי ו־MongoDB מחזיק את הקרנת האירועים.

ממשקים גרפיים קיימים ב־[pgAdmin ל־PostgreSQL](https://www.pgadmin.org/) וב־[MongoDB Compass](https://www.mongodb.com/try/download/compass). תצורת הדמו מחזיקה את מסדי הנתונים ברשת Docker; חיבור מכלי שמותקן ב־Windows יצריך מיפוי פורט מקומי, ואילו פקודות `docker compose exec` זמינות כבר עכשיו.
