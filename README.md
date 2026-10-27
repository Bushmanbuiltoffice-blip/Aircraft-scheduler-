# Rampboard

Rampboard is the scheduling desk for Bushman Aviation at Hobby Field (77S) in Creswell, Oregon. It keeps the rental fleet, instructor time, and pilot reservations in one place, and it runs entirely on Cloudflare.

Times on the board are Pacific time (`America/Los_Angeles`).

You do not need to be a programmer to run this. The steps below are copy-and-paste.

## What you can do

- Keep the fleet: tail number, make and model, wet and dry hourly rates, notes, and whether the airplane is available or grounded.
- Mark an airplane down for maintenance on a date range. Those hours cannot be booked. Grounding an airplane blocks every new booking until you return it to service.
- Sign people in with email and a password. Roles are admin, instructor, and pilot (stored internally as “renter”).
- Keep a pilot record: certificate, medical expiration, and which airplanes they are checked out in. An expired or missing medical blocks a booking. A pilot who is not checked out in that airplane is also blocked. Instructors can still book a checkout ride. An admin can override the medical and checkout rules with a checkbox. Nobody can override a maintenance block, a grounded airplane, or a double booking.
- See the day or the week, with airplanes or instructors down the side, and reservations on the board.
- Book, change, or cancel a reservation. The same airplane and the same person cannot be on two flights at once.
- Check a flight out, then check it back in with Hobbs and tach. Rampboard stores the flight time and the cost (airplane rate, plus the instructor rate when an instructor is on the flight).
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

Seeding loads obviously fake people and airplanes. Every sample account uses the same password: `Pattern123!`

| Who | Email | What they can do |
| --- | --- | --- |
| Kyle Bushman | kyle.bushman@example.com | Admin. Sees the whole operation. |
| Maya Chen | maya.chen@example.com | Instructor. |
| Priya Shah | priya.shah@example.com | Pilot, current medical, checked out in the 172 and the Archer. |
| Sam Okonkwo | sam.okonkwo@example.com | Pilot whose medical is expired. Booking is blocked. |

Change these passwords before anyone outside your office uses the site. The phone numbers and `@example.com` addresses are not real.

**Seeding deletes everything already in the database** and replaces it with the sample. That includes real reservations if you run it again later. On your computer that is fine while you are trying it out. Do not run the remote seed (below) against a database that already has real flights.

If you skip the seed, the first visit opens a one-time setup page and creates the first admin. After that, only an admin can add people. There is no public sign-up.

### Local sign-in secret

Copy the example secrets file once:

```bash
cp .dev.vars.example .dev.vars
```

Open `.dev.vars` and replace the placeholder with a long random string. Wrangler reads this file when you start the app. If you leave it out, the app still runs, and admins see a banner that the built-in development secret is in use. Changing the secret signs everyone out. It does not change passwords.

Stop the app with Ctrl+C in the same terminal.

## Put it on Cloudflare

Do this once, from the same project folder, after you have a free [Cloudflare account](https://dash.cloudflare.com/sign-up). Nothing in this repository is already deployed.

1. Install the project the same way as above (`npm install`) if you have not already.
2. Log in:

   ```bash
   npx wrangler login
   ```

   A browser window opens. Approve access for the Cloudflare account that should own the site.

3. Create the database:

   ```bash
   npx wrangler d1 create rampboard
   ```

   Cloudflare prints a `database_id` that looks like `a1b2c3d4-....`. Copy that value.

4. Open `wrangler.jsonc` in a text editor. Replace the placeholder `database_id` (`00000000-0000-0000-0000-000000000000`) with the id from the previous step. Save the file. Leave the binding name as `DB` and the database name as `rampboard`.

5. Create the tables on Cloudflare:

   ```bash
   npm run db:migrate:remote
   ```

   When it asks for confirmation, answer yes.

6. Set the sign-in secret **before** you create any real accounts:

   ```bash
   npx wrangler secret put SESSION_SECRET
   ```

   Paste a long random string (a password manager can generate one) and press Enter. The characters will not show as you paste. That is normal. This secret is not stored in the git repository. If you change it later, everyone has to sign in again. Passwords stay the same.

7. Publish the site:

   ```bash
   npm run deploy
   ```

   Wrangler prints a `*.workers.dev` address. That is your site. Open it, and either load sample data (next step) or use the one-time setup page to create your admin account.

8. Optional: load the fake sample data onto Cloudflare. This **erases** whatever is already in that database.

   ```bash
   npm run db:seed:remote -- --yes
   ```

   Without `--yes`, the command refuses to run. After you are done looking at the sample, create your real admin, delete the sample people, and do not seed again.

Later changes to the site are the same last command: `npm run deploy`. If a future update adds a new file under `migrations/`, run `npm run db:migrate:remote` again before or right after deploying.

### If deploy complains about `cpu_ms`

Password checks are intentionally slow so stolen password hashes are harder to guess. `wrangler.jsonc` asks Cloudflare for 30 seconds of CPU time for that. Some free accounts reject `limits.cpu_ms`. If deploy fails for that reason:

1. Delete the whole `limits` block from `wrangler.jsonc`.
2. In `src/auth.ts`, change `PBKDF2_ITERATIONS` from `100_000` to `10000`.
3. Run `npm run deploy` again.

Do this before you create accounts. Existing passwords keep the iteration count they were saved with, so you do not have to reset them if you change the number later. A higher number is safer. Raise it again if you move to a Workers plan that allows the CPU limit.

## Day-to-day use

Sign in, then:

- **Dashboard** shows today’s flights, what is still checked out, airplane status, upcoming reservations, and (for admins) charges by pilot for the month.
- **Schedule** is the day board. Switch to Week, or switch the rows from airplanes to instructors. Click a reservation to open it. **New reservation** is on that page.
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
| `npm run db:seed:remote -- --yes` | Replaces the Cloudflare database with sample data |
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
