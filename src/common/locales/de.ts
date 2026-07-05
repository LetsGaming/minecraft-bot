/**
 * German locale. Keys missing here fall back to English per key.
 */
export const de: Record<string, string> = {
  // ── common ──
  "common.serverNotFound": "Server nicht gefunden.",
  "common.noPermission": "Du hast keine Berechtigung für diesen Befehl.",
  "common.invalidUsername":
    "**{username}** ist kein gültiger Minecraft-Benutzername.",

  // ── whois ──
  "whois.title": "Whois — {username}",
  "whois.noData":
    "Keine Whitelist- oder Link-Daten für **{username}** gefunden.",
  "whois.addedBy": "Hinzugefügt von",
  "whois.addedAt": "Hinzugefügt am",
  "whois.server": "Server",
  "whois.uuid": "UUID",
  "whois.removedBy": "Entfernt von",
  "whois.removedAt": "Entfernt am",
  "whois.linkedAccount": "Verknüpfter Discord-Account",
  "whois.notLinked": "Nicht verknüpft",

  // ── daily reminders ──
  "dailyReminder.enabled":
    "✅ Tägliche Erinnerungen aktiviert — ich schicke dir eine DM, sobald dein nächstes /daily bereit ist. Stelle sicher, dass deine DMs für diesen Server offen sind.",
  "dailyReminder.disabled": "✅ Tägliche Erinnerungen deaktiviert.",
  "dailyReminder.dmServer":
    "🎁 Deine tägliche Belohnung auf **{server}** ist bereit! Hol sie dir mit /daily server:{server}.",
  "dailyReminder.dm":
    "🎁 Deine tägliche Belohnung ist bereit! Hol sie dir mit /daily auf dem Server ab.",

  // ── slime (!slime) ──
  "slime.noSeed": "Konnte den Welt-Seed nicht abrufen.",
  "slime.noPosition": "Konnte deine Position nicht ermitteln. Versuch es gleich nochmal.",
  "slime.wrongDimension": "Slime-Chunks gibt es nur in der Oberwelt.",
  "slime.yes": "Chunk [{cx}, {cz}] IST ein Slime-Chunk! 🟢",
  "slime.no": "Chunk [{cx}, {cz}] ist kein Slime-Chunk.",

  // ── death position (!deathpos + watcher DM) ──
  "deathpos.none":
    "Kein Tod gefunden — vielleicht bist du in dieser Welt noch nicht gestorben.",
  "deathpos.result": "☠ Dein letzter Tod: {x} / {y} / {z} ({dimension})",
  "deathpos.dm":
    "☠ Du bist auf **{server}** bei **{x} / {y} / {z}** ({dimension}) gestorben. Hol deine Sachen, bevor sie despawnen!",

  // ── waypoints ──
  "waypoint.usage":
    "Nutzung: !waypoint <name> — nachschlagen | !waypoint set <name> [kategorie] — speichern | !waypoint del <name> — eigenen löschen",
  "waypoint.invalidName":
    "Waypoint-Namen dürfen nur Buchstaben, Zahlen, _ oder - enthalten (max. 24 Zeichen).",
  "waypoint.noPosition": "Konnte deine Position nicht ermitteln. Versuch es gleich nochmal.",
  "waypoint.taken": 'Waypoint "{name}" gehört {author} — nur er/sie kann ihn ändern.',
  "waypoint.limitReached": "Dieser Server hat bereits {max} Waypoints.",
  "waypoint.saved": '📍 Waypoint "{name}" bei {x} / {y} / {z} gespeichert.',
  "waypoint.deleted": 'Waypoint "{name}" gelöscht.',
  "waypoint.notFound": 'Kein Waypoint namens "{name}". Mit !waypoints alle anzeigen.',
  "waypoint.result": "📍 {name}: {x} / {y} / {z} ({dimension}) — gesetzt von {author}",
  "waypoint.noneInGame": "Noch keine Waypoints. Erstelle einen mit: !waypoint set <name>",
  "waypoint.listHeader": "📍 Waypoints auf diesem Server ({count}):",
  "waypoint.listMore": "…und {more} weitere — siehe /waypoints auf Discord.",
  "waypoint.embedTitle": "📍 Waypoints — {server}",
  "waypoint.embedFooter": "Seite {page}/{pages} • {count} Waypoints",
  "waypoint.embedEntry": "`{x} / {y} / {z}` ({dimension}) — von **{author}**, {date}",
  "waypoint.noneDiscord":
    "Noch keine Waypoints. Spieler können sie ingame mit `!waypoint set <name>` erstellen.",

  // ── reports (!report) ──
  "report.usage": "Nutzung: !report <nachricht>",
  "report.embedTitle": "🚨 Report von {player}",
  "report.sent": "✅ Dein Report wurde an die Admins geschickt. Danke!",
  "report.noChannel":
    "Reports sind für diesen Server noch nicht eingerichtet — wende dich bitte direkt an einen Admin.",

  // ── daily delivery queue ──
  "daily.queueFull":
    "Es warten bereits {max} nicht abgeholte Belohnungen ingame auf dich. Joine den Server und hol sie ab, bevor du erneut claimst.",
  "daily.queued":
    "📦 Du bist auf **{server}** gerade offline — deine Belohnung ist vorgemerkt und wird beim nächsten Join geliefert. Deine Streak ist sicher!",
  "daily.delivered": "📦 {count} vorgemerkte Daily-Belohnung(en) geliefert. Viel Spaß!",

  // ── sessions ──
  "sessions.none": "Noch keine Session-Daten für **{player}** auf **{server}**.",
  "sessions.onlineNow": "🟢 Gerade online",
  "sessions.lastSeen": "Zuletzt gesehen {when}",
  "sessions.lastSeenUnknown": "Zuletzt gesehen: unbekannt",
  "sessions.title": "Sessions — {player} @ {server}",
  "sessions.playtime": "Spielzeit (zuletzt)",
  "sessions.playtimeValue": "{duration} über die letzten {count} Session(s)",
  "sessions.recent": "Letzte {count} Session(s)",
  "sessions.stillOnline": "noch online",

  // ── whois additions ──
  "whois.lastSeen": "Zuletzt gesehen",
  "whois.onlineNow": "🟢 Gerade online auf **{server}**",
  "whois.lastSeenValue": "{when} auf **{server}**",
  "whois.notes": "Admin-Notizen",
  "whois.moreNotes": "…und {more} weitere — siehe /note list.",

  // ── admin notes (/note) ──
  "note.unknownPlayer":
    "**{player}** ist diesem Server nicht bekannt (weder Whitelist noch User-Cache).",
  "note.emptyText": "Der Notiztext darf nicht leer sein.",
  "note.addedTitle": "Notiz hinzugefügt",
  "note.added": "Notiz für **{player}** gespeichert.",
  "note.removedTitle": "Notiz entfernt",
  "note.removed": "Notiz #{index} für **{player}** entfernt.",
  "note.badIndex": "Keine Notiz mit dieser Nummer für **{player}** — siehe /note list.",
  "note.none": "Keine Notizen für **{player}**.",
  "note.listTitle": "Notizen — {player}",
  "note.listFooter": "{count}/{max} Notizen",

  // ── challenges ──
  "challenge.alreadyActive":
    'Es läuft bereits eine Challenge: **{advancement}**. Brich sie ab oder warte auf einen Gewinner.',
  "challenge.noneActive": "Keine aktive Challenge auf **{server}**.",
  "challenge.noneYet": "Auf **{server}** gab es noch keine Challenges.",
  "challenge.statusTitle": "🏆 Challenge — {status}",
  "challenge.status.active": "aktiv",
  "challenge.status.won": "gewonnen",
  "challenge.status.expired": "abgelaufen",
  "challenge.status.cancelled": "abgebrochen",
  "challenge.fieldAdvancement": "Wer zuerst **{advancement}** erspielt, gewinnt",
  "challenge.fieldItem": "Item-Bonus: {amount}× {item}",
  "challenge.fieldStartedBy": "Gestartet von {by} {when}",
  "challenge.fieldEnds": "Endet {when}",
  "challenge.fieldWonBy": "Gewonnen von **{player}** 🎉",
  "challenge.rewardLine": "🎁 Belohnung: {reward}",
  "challenge.startedTitle": "🏆 Neue Challenge!",
  "challenge.startedEmbed": "Wer zuerst **{advancement}** erspielt, gewinnt!",
  "challenge.startedInGame":
    "🏆 Neue Challenge: Wer zuerst \"{advancement}\" erspielt, gewinnt!",
  "challenge.wonTitle": "🏆 Challenge gewonnen!",
  "challenge.wonEmbed": "**{player}** hat als Erste(r) **{advancement}** erspielt!",
  "challenge.wonInGame": "🏆 {player} hat die Challenge \"{advancement}\" gewonnen!",
  "challenge.cancelledTitle": "Challenge abgebrochen",
  "challenge.cancelled": "Challenge **{advancement}** abgebrochen.",

  // ── polls ──
  "poll.alreadyActive":
    'Es läuft bereits eine Umfrage: "{question}". Schließe sie, bevor du eine neue startest.',
  "poll.noneActive": "Keine offene Umfrage auf **{server}**.",
  "poll.noneInGame": "Gerade läuft keine Umfrage.",
  "poll.needChannel": "Umfragen müssen in einem Textkanal erstellt werden.",
  "poll.badOptions": "Bitte gib {min}–{max} Optionen getrennt durch | an.",
  "poll.howToVote": "Stimme mit den Buttons ab oder ingame mit `!vote <nummer>`.",
  "poll.ends": "Endet",
  "poll.voted": '✅ Stimme gezählt: "{option}"',
  "poll.badVote": "Bitte stimme mit einer Zahl zwischen 1 und {max} ab.",
  "poll.voteHint": "Abstimmen mit: !vote <nummer>",
  "poll.announceInGame": '🗳️ Neue Umfrage: "{question}"',
  "poll.closedReply": "Diese Umfrage ist bereits geschlossen.",
  "poll.closedTitle": "Umfrage geschlossen",
  "poll.closed": 'Umfrage "{question}" geschlossen und Ergebnisse verkündet.',
  "poll.resultTitle": "🗳️ Umfrage-Ergebnisse",
  "poll.resultTotal": "{total} Stimme(n) insgesamt",
  "poll.resultInGame": '🗳️ Umfrage-Ergebnisse: "{question}"',

  // ── host resources ──
  "status.hostTitle": "Host",
  "status.hostProcess": "Prozess: {ram} RAM, {cpu}% CPU",
  "status.hostDisk": "`{path}`: {percent}% belegt ({free} frei)",
  "hostAlerts.diskFullTitle": "⚠️ Speicherplatz-Warnung",
  "hostAlerts.diskFull":
    "**{server}**: `{path}` ist zu **{percent}%** belegt ({free} frei). Backups und Welt-Speicherung könnten bald fehlschlagen.",
  "hostAlerts.diskOkTitle": "✅ Speicherplatz wieder ok",
  "hostAlerts.diskOk": "**{server}**: `{path}` ist wieder bei {percent}% Belegung.",

  // ── downtime + TPS alerts ──
  "downtime.upTitle": "✅ Server wieder online",
  "downtime.up": "**{server}** ist wieder online.",
  "downtime.downTitle": "🔴 Server offline",
  "downtime.down":
    "**{server}** scheint offline zu sein.\n{failures} Prüfungen in Folge fehlgeschlagen.",
  "tps.lowTitle": "⚠️ Niedrige-TPS-Warnung",
  "tps.low": "Die Server-TPS sind unter {threshold} gefallen",

  // ── /daily-admin ──
  "dailyAdmin.unknownServer":
    'Unbekannter Server "{server}". Konfigurierte Server: {servers}',
  "dailyAdmin.samServer": "Quell- und Zielserver sind identisch.",
  "dailyAdmin.noRecord": "**{user}** hat keinen Claim-Eintrag auf **{server}**.",
  "dailyAdmin.targetExists":
    "**{user}** hat bereits einen Eintrag auf **{server}** — overwrite:true zum Überschreiben.",
  "dailyAdmin.moved": "Daily-Eintrag von **{user}** von **{from}** nach **{to}** verschoben.",
  "dailyAdmin.reset": "Daily-Eintrag von **{user}** auf **{server}** zurückgesetzt.",
  "dailyAdmin.showTitle": "Daily-Einträge — {user}",
  "dailyAdmin.showLine":
    "**{server}**: Streak {streak} (Rekord {longest}), letzter Claim {last}",
  "dailyAdmin.showNone": "Keine Claim-Einträge auf irgendeinem Server.",

  // ── waypoint categories ──
  "waypoint.invalidCategory":
    "Kategorien dürfen nur Buchstaben, Zahlen, _ oder - enthalten (max. 16 Zeichen).",
  "waypoint.noneInCategory": 'Keine Wegpunkte in der Kategorie "{category}".',

  // ── span polls ──
  "poll.alreadyActiveOn":
    'Auf **{server}** läuft bereits eine Umfrage: "{question}". Erst schließen oder den Server aus der Liste nehmen.',

  // ── backup staleness ──
  "backupAlert.staleTitle": "⚠️ Backups veralten",
  "backupAlert.stale":
    "**{server}**: das neueste Backup ist **{age}h** alt (Schwelle {max}h). Backup-Job prüfen, bevor es drauf ankommt.",
  "backupAlert.freshTitle": "✅ Frisches Backup erkannt",
  "backupAlert.fresh": "**{server}**: ein neues Backup ist da ({age}h alt).",

  // ── moderation shortcuts ──
  "moderation.kicked": "**{player}** von **{server}** gekickt.",
  "moderation.banned": "**{player}** auf **{server}** gebannt.",
  "moderation.pardoned": "**{player}** auf **{server}** entbannt.",

  // ── /activity ──
  "activity.title": "📈 Aktivität — {server}",
  "activity.noData":
    "Noch keine Spielerzahl-Historie für **{server}** — Daten sammeln sich, während der Bot läuft.",
  "activity.last24h": "Durchschnittliche Spieler, letzte 24h (alt → neu):",
  "activity.peak": "Spitze in dem Zeitraum: **{peak}**",
  "activity.busiest": "Stoßzeiten ({tz}, 14-Tage-Schnitt):",
  "activity.busyLine": "**{hour}:00–{next}:00** — Ø {avg} Spieler",
  "activity.noBusyData": "Noch nicht genug Daten.",

  // ── /console ──
  "console.tailTitle": "letzte {lines} Log-Zeile(n)",
  "console.emptyLog": "(Log ist leer)",
  "console.guildOnly": "Der Live-Relay ist pro Discord-Server — bitte dort verwenden.",
  "console.noChannel":
    'Kein Konsolen-Channel für diese Guild konfiguriert. Erst guilds.<id>.console.channelId in config.json setzen.',
  "console.liveEnabled":
    "Live-Konsole für **{server}** läuft jetzt in {channel} (gebündelt alle paar Sekunden).",
  "console.liveDisabled": "Live-Konsole für **{server}** deaktiviert.",

  // ── scheduled restarts ──
  "schedule.warnInGame": "Server-Neustart in {minutes} Minute(n)!",
  "schedule.warnTitle": "🔄 Geplanter Neustart steht an",
  "schedule.warn": "**{server}** startet in **{minutes} min** neu (um {time}).",
  "schedule.doneTitle": "🔄 Geplanter Neustart ausgeführt",
  "schedule.done": "**{server}**: der geplante Neustart wurde ausgelöst.",

  // ── /daily-history ──
  "dailyHistory.title": "🗓️ Daily-Claims — {server}",
  "dailyHistory.none":
    "Noch keine Claims für dich auf **{server}** — `/daily` startet die Historie.",
  "dailyHistory.line": "{when} · Streak {streak} — {items}",
  "dailyHistory.footer": "{shown} von {total} gespeicherten Claim(s)",

  // ── /profile ──
  "profile.title": "👤 {player}",
  "profile.noPlayer":
    "Kein Spieler angegeben und kein verknüpfter Account — player: mitgeben oder erst /link ausführen.",
  "profile.linked": "🔗 Verknüpft mit {mention}",
  "profile.notLinked": "🔗 Mit keinem Discord-Account verknüpft",
  "profile.whitelisted": "📋 Gewhitelistet von {by} am {at}",
  "profile.playtime": "⏱️ {playtime} Spielzeit über {sessions} Session(s)",
  "profile.onlineNow": "🟢 Gerade online",
  "profile.lastSeen": "⚪ Zuletzt gesehen {when}",
  "profile.streak": "🔥 Daily-Streak: {current} (Rekord {longest})",
  "profile.nothingKnown": "Zu diesem Spieler ist auf diesem Server noch nichts bekannt.",

  // ── milestones ──
  "milestone.title": "🏅 Meilenstein erreicht!",
  "milestone.body": "**{player}** hat gerade **{value}** {stat} geknackt!",
  "milestone.inGame": "{player} hat gerade {value} {stat} geknackt!",

  // ── /watch ──
  "watch.listTitle": "👁️ Deine Watches",
  "watch.listNone": "Keine aktiven Watches. Probier `/watch server` oder `/watch player`.",
  "watch.listServer": "`{id}` — Server **{server}** wieder online",
  "watch.listPlayer": "`{id}` — Spieler **{player}** joint **{server}**",
  "watch.notFound": "Kein Watch mit der ID `{id}` auf deinem Account.",
  "watch.removed": "Watch `{id}` entfernt.",
  "watch.limit": "Du hast bereits {max} Watches — entferne erst einen (/watch list).",
  "watch.duplicate": "Genau diesen Watch hast du schon aktiv.",
  "watch.serverArmed":
    "Aktiv: du bekommst **eine DM**, sobald **{server}** wieder online ist. DMs müssen offen sein.",
  "watch.playerArmed":
    "Aktiv: du bekommst **eine DM**, sobald **{player}** auf **{server}** joint. DMs müssen offen sein.",
  "watch.dmServer": "✅ **{server}** ist wieder online. (Dieser Watch ist damit verbraucht.)",
  "watch.dmPlayer": "👋 **{player}** ist gerade **{server}** beigetreten. (Dieser Watch ist damit verbraucht.)",

  // ── whitelist applications ──
  "wlapp.promptTitle": "📋 Whitelist-Bewerbung",
  "wlapp.promptBody":
    "Du willst auf dem Server spielen? Klick den Button, nenn uns deinen Minecraft-Namen, und ein Admin schaut drüber.",
  "wlapp.applyButton": "Für Whitelist bewerben",
  "wlapp.modalTitle": "Whitelist-Bewerbung",
  "wlapp.modalName": "Dein Minecraft-Name",
  "wlapp.modalNote": "Gibt's was, das die Admins wissen sollten? (optional)",
  "wlapp.invalidName": "**{name}** ist kein gültiger Minecraft-Name.",
  "wlapp.noServer":
    "Diese Guild hat mehrere Server und keinen Default — ein Admin muss erst guilds.<id>.defaultServer setzen.",
  "wlapp.alreadyPending":
    "Du hast bereits eine offene Bewerbung — ein Admin kümmert sich darum.",
  "wlapp.queueBroken":
    "Der Bewerbungs-Channel ist nicht erreichbar — sag bitte einem Admin Bescheid.",
  "wlapp.submitted":
    "Bewerbung für **{name}** auf **{server}** eingereicht — du bekommst eine DM, sobald entschieden ist (DMs müssen offen sein).",
  "wlapp.queueTitle": "📋 Whitelist-Bewerbung",
  "wlapp.queueApplicant": "Bewerber: {mention} ({tag})",
  "wlapp.queueName": "Minecraft-Name: **{name}**",
  "wlapp.queueServer": "Server: **{server}**",
  "wlapp.queueNote": "Notiz: {note}",
  "wlapp.approveButton": "Annehmen",
  "wlapp.denyButton": "Ablehnen",
  "wlapp.notAdmin": "Nur Server-Admins können über Bewerbungen entscheiden.",
  "wlapp.stale": "Diese Bewerbung wurde bereits entschieden (oder existiert nicht mehr).",
  "wlapp.serverGone":
    "Server **{server}** ist nicht mehr konfiguriert — die Bewerbung kann nicht angenommen werden.",
  "wlapp.approveFailed": "Whitelisting fehlgeschlagen: {error}",
  "wlapp.approvedBy": "✅ Angenommen von {by}",
  "wlapp.deniedBy": "⛔ Abgelehnt von {by}",
  "wlapp.dmApproved":
    "✅ Deine Whitelist-Bewerbung für **{name}** wurde angenommen — willkommen auf **{server}**!",
  "wlapp.dmDenied": "⛔ Deine Whitelist-Bewerbung für **{name}** wurde abgelehnt.",
  "wlapp.modalServer": "Welcher Server?",
};
