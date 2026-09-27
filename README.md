# glip
HackNotts' General Letting-In Program

A bot for verifying HackNotts attendees. Connects to ti.to and checks that a user has a ticket before assigning them a role, allowing them access into a server.

## Setup

0. Install node,js
1. Copy `.env.example` to `.env` and fill in the values.
2. Run the following:

   ```
   npm install
   npm run dev
   ```

## Commands

- `/verify ticket:IGLN-6` verifies  own ticket.
- `/verify ticket:IGLN-6 user:@attendee` lets an administrator verify another server member. Must be a valid user <-> ticket pair.
- `/checkticket ticketreference:IGLN-6` shows the attendee name, registered Discord username, ticket reference, and ticket status. Admins only.
- `/checkuser user:@attendee` finds all tickets whose registered Discord username matches that user. Administrators only.
