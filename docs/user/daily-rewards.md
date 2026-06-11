# Daily rewards

Claim a random in-game item once a day and build a streak for bonus loot.

## Claiming

```
/daily
```

Requirements:

- Your account is [linked](linking.md).
- You are online on the Minecraft server at the moment you claim. The item lands directly in your inventory.

After a claim there is a 24-hour cooldown. If you try too early, the bot tells you exactly how long is left and at what time your next claim is ready.

## Streaks

Claiming on consecutive days builds a streak. The rules:

- You have up to 48 hours between claims to keep the streak alive.
- Miss that window and the streak restarts at 1 with your next claim.
- At certain milestones (for example day 3, 6, 10, 14, ...) you get bonus items on top of the regular reward. The milestone schedule is set by the server admin.
- After the highest milestone, the bonus cycle starts over, so milestone rewards repeat. Your visible streak number keeps counting up.

## Checking your streak

```
/streak
```

Shows your current streak, your longest streak ever, and the next bonus milestone.

## Tips

- The reward is drawn from a weighted pool: common items drop often, rare ones (think enchanted golden apples) rarely. Every claim is a small lottery.
- Claim right when you log in for a play session, then it is done and your streak is safe.
- If `/daily` says you must be online: join the server first, then run the command.
