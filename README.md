# Firehound Rental

Firehound Rental is the scheduling desk for the rental airplane and instructor at Hobby Field (77S) in Creswell, Oregon. It keeps the airplane, instructor time, and pilot reservations in one place, and it runs entirely on Cloudflare.

The next deploy publishes at [https://firehound-rental.bushmanbuiltoffice.workers.dev](https://firehound-rental.bushmanbuiltoffice.workers.dev).

Times on the board are Pacific time (`America/Los_Angeles`).

The name on the screen is **Firehound Rental**. Every page, calendar feed, and notification reads one setting, `ORG_NAME`, in `src/types.ts`. Change that one string to rename the operation, save the file, then start the site again or deploy. You do not need to change it anywhere else.

You do not need to be a programmer to run this. The steps below are copy-and-paste.

## What you can do

- Keep the fleet: tail number, make and model, wet and dry hourly rates, notes, and whether the airplane is available or grounded.
- Mark an airplane down for maintenance on a date range. Those hours cannot be booked. Grounding an airplane blocks every new booking until you return it to service.
- Sign people in with email and a password. Roles are admin, instructor, and pilot (stored internally as “renter”).
- Keep a pilot record: certificate, medical expiration, and which airplanes they are checked out in. An expired or missing medical blocks a booking. A pilot who is not checked out in that airplane is also blocked. Instructors can still book a checkout ride. An admin can override the medical and checkout rules with a checkbox. Nobody can override a maintenance block, a grounded airplane, or a double booking.
- See the day or the week, with airplanes or instructors down the side, and reservations on the board.
- Book, change, or cancel a reservation. The same airplane and the same person cannot be on two flights at once.
- Check a flight out, then check it back in with Hobbs and tach. Firehound Rental stores the flight time and the cost (airplane rate, plus the instructor rate when an instructor is on the flight).
- See today’s board, what is coming up, airplane status, and a flight-log and billing list for each pilot.
- Subscribe to a private calendar feed from the Account page. Mail is saved in an outbox on the dashboard so a real email service can be plugged in later. Nothing is sent to the internet yet.

## Run it on your computer

You need [Node.js 22 or newer](https://nodejs.org). On a Mac, the installer from that site is enough. Then open Terminal (or Command Prompt on Windows), go into this project folder, and run the commands one at a time.

```bash
npm install
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

Open [http://localhost:8787](http://localhost:8787).

If `npm install` fails with a message about `edgesOut` or `ERESOLVE`, your npm is version 10. Install with a newer npm instead:

```bash
npx --yes npm@11 install
```

Then continue with the migrate, seed, and dev commands above.

### Sample logins

Seeding loads the real airplane and instructor, plus made-up pilots so the board is not empty. Every sample account uses the same password: `Pattern123!`

The airplane is **N1561Y**, a Cessna 172C. The wet rate in the sample is **$155 an hour**, which is the rate to use. The dry rate is blank on purpose. Open the airplane and type a dry rate when you have one. Until then, book wet. A dry reservation is refused.

The instructor is **Juan Valdivia** at **$75 an hour**. The pilots (Priya, Luis, Sam, and Jordan) are not real people. Their Hobbs and tach numbers are samples, not the airplane’s current meters. Set the real meters on the airplane page before you check a real flight out.

| Who | Email | What they can do |
| --- | --- | --- |
| Kyle Bushman | kyle.bushman@example.com | Admin. Sees the whole operation. |
| Juan Valdivia | juan.valdivia@example.com | Instructor, $75 an hour. |
| Priya Shah | priya.shah@example.com | Sample pilot, current medical, checked out in N1561Y. |
| Sam Okonkwo | sam.okonkwo@example.com | Sample pilot whose medical is expired. Booking is blocked. |

Change these passwords before anyone outside your office uses the site. The phone numbers and `@example.com` addresses are not real.

**This local sample seed deletes everything already in the database** and replaces it with the sample, including real reservations if you run it again later. On your computer that is fine while you are trying the board. Do not run `npm run db:seed:local` or `npm run db:seed:remote` against the live Cloudflare database.

The live database uses a different seed, `scripts/prod-seed.sql` (or `npm run db:seed:prod -- --yes`). That file adds only N1561Y and Juan Valdivia. It does not add fake pilots, reservations, or Hobbs and tach numbers, and it does not delete rows that are already there. Juan has no email and no sign-in. After the site is up, the first visitor creates the admin account. Once any admin exists, that setup page stays closed. Add Juan’s email and a password later under People.

If you skip every seed, the first visit still opens setup and creates the admin. There is no public sign-up.

### Local sign-in secret

Copy the example secrets file once:

```bash
cp .dev.vars.example .dev.vars
```

Open `.dev.vars` and replace the placeholder with a long random string. Wrangler reads this file when you start the app. If you leave it out, the app still runs, and admins see a banner that the built-in development secret is in use. Changing the secret signs everyone out. It does not change passwords.

Stop the app with Ctrl+C in the same terminal.

## Put it on Cloudflare

The next deploy publishes at [https://firehound-rental.bushmanbuiltoffice.workers.dev](https://firehound-rental.bushmanbuiltoffice.workers.dev). The Worker name in `wrangler.jsonc` is `firehound-rental`. The D1 database stays `rampboard`, and its id is already in `wrangler.jsonc`, so existing airplanes and accounts stay. The free plan is enough. `wrangler.jsonc` does not ask for a CPU limit the free plan would reject.

The token needs permission to edit Workers scripts, edit D1, and read the account. Create it under My Profile → API Tokens. Do not commit the token, and do not paste it into the chat.

```bash
npm install
export CLOUDFLARE_API_TOKEN='paste-the-token-here'
bash scripts/deploy-prod.sh
```

If that token can see more than one Cloudflare account, the script stops and lists the account ids. Run it again with the right one:

```bash
export CLOUDFLARE_ACCOUNT_ID='the-account-id-from-the-list'
bash scripts/deploy-prod.sh
```

The script looks up the account, creates the D1 database named `rampboard` if needed, writes that database id into `wrangler.jsonc`, creates the tables, and adds N1561Y and Juan only when the fleet is empty. It generates the sign-in secret and stores it with `wrangler secret put` when one is not already stored. It does not print the token or the secret. Then it publishes the site and prints the `*.workers.dev` address.

Open that address. The first page asks you to create the admin account with your own email and password. After that, setup closes. Juan is already on the People list at $75 an hour, with no email and no way to sign in. N1561Y is the airplane at $155 an hour wet, and the dry rate is blank. Under People, add Juan’s email and a password when you have them.

If the account has never used Workers, it may not have a `workers.dev` name yet. The script tries to register one. If Cloudflare refuses, the script prints a dashboard link. Choose a name there, then run `bash scripts/deploy-prod.sh` again. The second run will not add another airplane.

You can also do the same steps by hand:

1. `npx wrangler login`
2. `npx wrangler d1 create rampboard`
3. The production `database_id` is already in `wrangler.jsonc`. `scripts/deploy-prod.sh` writes it there when it creates the database.
4. `npm run db:migrate:remote`
5. `npm run db:seed:prod -- --yes` (only on an empty fleet)
6. `npx wrangler secret put SESSION_SECRET` with a long random string. Changing it later signs everyone out. Passwords stay the same.
7. `npm run deploy`

Do not run `npm run db:seed:remote` on the live database. That command erases the database and loads the fake pilots.

Later code changes are `npm run deploy`, or another run of `bash scripts/deploy-prod.sh`. If a future update adds a file under `migrations/`, the script applies it. The production seed runs only while the aircraft table is empty.

Password checks use 10,000 rounds so they fit the free plan’s CPU limit. The number is `PBKDF2_ITERATIONS` in `src/auth.ts`. Existing passwords keep the count they were saved with. A paid Workers plan can raise that number.

## Day-to-day use

Sign in, then:

- **Dashboard** shows today’s flights, what is still checked out, airplane status, upcoming reservations, and (for admins) charges by pilot for the month.
- **Schedule** is the day board. Switch to Week or Month, or switch the rows from airplanes to instructors. Month is a Sunday-to-Saturday calendar in Pacific time. Each day lists that airplane’s flights (time, pilot, and instructor when there is one) and marks maintenance. Tap a day to open that day’s board. On a phone, a day shows a count and dots until you tap it open. Click a reservation to open it. **New reservation** is on that page.
- **Aircraft** is the fleet. Open an airplane to edit rates or to mark it down for maintenance. “Also mark grounded now” takes it off the line immediately. **Return to service** makes it available again. A maintenance block still blocks the hours it covers even after the airplane is available.
- **People** is where an admin adds pilots and instructors and sets checkouts. Pilots do not see this menu. Everyone can open **Account** to update their own phone number and medical date, change their password, and copy their calendar link.
- **Flight logs** lists completed flights and the Hobbs time and charges.

On a reservation, **Check out** records the Hobbs and tach at departure. **Check in** records the return readings, computes the time and the price, and writes the flight log. Hobbs time is what gets billed. Tach is stored and is not billed. The instructor, when one is assigned, is billed for the same Hobbs time at their hourly rate.

Back-to-back flights are allowed. Overlapping ones are not. A reservation has to be at least 30 minutes and at most 16 hours, and the end time cannot already be in the past.

## Calendar feeds

Each person has a private iCal link on **Account**. It includes their flights from 90 days ago through the next year, and it leaves out cancelled flights. Paste it into Apple Calendar, Google Calendar, or Outlook as a subscribed calendar. Treat the link like a password. **Reset calendar link** on that page invalidates the old one.

The sample links are predictable on purpose (`demo-ical-kyle` and similar). Reset them, or skip the sample data, before real pilots use the feed.

## Email later

Booking, changing, cancelling, and checking in a flight already write a message for the pilot and the instructor. Those messages sit in the `email_outbox` table and show on the admin dashboard. They are also printed in the terminal when you run locally. No mail provider is connected.

To send real mail later, replace `OutboxEmailSender` in `src/email.ts` with a class that calls your provider. The rest of the app already calls that one hook.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the site on your computer at http://localhost:8787 |
| `npm test` | Runs the booking, conflict, checkout, and billing checks |
| `npm run typecheck` | Checks the code for type errors |
| `npm run db:migrate:local` | Creates the tables in the local database |
| `npm run db:migrate:remote` | Creates the tables in Cloudflare |
| `npm run db:seed:local` | Replaces the local database with sample data |
| `npm run db:seed:remote -- --yes` | Replaces the Cloudflare database with the fake sample. Do not use this on the live site |
| `npm run db:seed:prod -- --yes` | Adds N1561Y and Juan Valdivia to Cloudflare. Does not delete existing rows |
| `bash scripts/deploy-prod.sh` | Creates the database, migrates, seeds production if the fleet is empty, sets the sign-in secret, and publishes |
| `npm run deploy` | Publishes the site. Requires the steps in “Put it on Cloudflare” first |

## Project layout

| Path | What it is |
| --- | --- |
| `src/` | The website and the API, one Cloudflare Worker |
| `public/` | Styles, the check-in calculator, and the icon |
| `migrations/` | Database tables. Applied in order, never edited after they have been used on Cloudflare |
| `scripts/seed.ts` | Builds and loads the sample data |
| `test/` | Automated checks for the core flows |
| `wrangler.jsonc` | Cloudflare project settings, including the database id |

The pages are rendered by the Worker (Hono). There is no separate frontend build. `npm run dev` and `npm run deploy` are the only run commands you need.
