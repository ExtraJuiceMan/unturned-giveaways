const Discord = require('discord.js');
const fs = require('fs');
const schedule = require('node-schedule');
const sqlite3 = require('sqlite3').verbose();
const SteamUser = require('steam-user');
const SteamCommunity = require('steamcommunity');
const SteamTotp = require('steam-totp');
const TradeOfferManager = require('steam-tradeoffer-manager');

const config = require("./config.json");
const embeds = require("./giveaway_embeds.js");
const db = new sqlite3.Database('./data.db');

const ITEM_TYPES = ["common", "premium", "mythical", "rare", "uncommon"];
var session_expire_login = 0;
var giveaway_time_check = 0;
var reminder_time_check = 0;
var not_eligible_cooldown = {};
var no_tradeurl_cooldown = {};

db.serialize(function () {
	db.run("CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, url TEXT)");
	db.run("CREATE TABLE IF NOT EXISTS entries(id INTEGER PRIMARY KEY)");
	db.run("CREATE TABLE IF NOT EXISTS blacklist(id INTEGER PRIMARY KEY)");
	db.run("CREATE TABLE IF NOT EXISTS giveaways(id INTEGER PRIMARY KEY, msgid INTEGER, winner INTEGER)");
});

var clientSteam = new SteamUser();
var community = new SteamCommunity();
var manager = new TradeOfferManager({
	"steam": clientSteam,
	"community": community,
	"domain": "localhost",
	"language": "en"
});

var logOnOptions = {
	"accountName": config.account_name,
	"password": config.password,
	"twoFactorCode": SteamTotp.getAuthCode(config.shared_secret),
	"rememberPassword": true
};

if (fs.existsSync('polldata.json')) {
	manager.pollData = JSON.parse(fs.readFileSync('polldata.json'));
}

clientSteam.logOn(logOnOptions);
clientSteam.on('loggedOn', function () {
	console.log(`Logged into Steam as: ${config.account_name}`);
	clientSteam.setPersona(SteamUser.Steam.EPersonaState.Online);
	clientSteam.gamesPlayed({
		"game_id": 304930,
		"game_extra_info": "Unturned"
	});
});

clientSteam.on('webSession', function (sessionID, cookies) {
	console.log('Logging into Steam websession and setting cookies...');
	community.setCookies(cookies);
	manager.setCookies(cookies, function (err) {
		if (err) {
			console.log(err);
			process.exit(1); // Fatal error since we couldn't get our API key
			return;
		}
		console.log('Done!');
	});
});

clientSteam.on("friendMessage", function (steamID, msg) {
	if (msg.indexOf(config.prefix) !== 0) {
		return;
	}
	clientSteam.getPersonas([steamID], function (personas) {
		var persona = personas[steamID];
		var name = persona ? persona.player_name : ("[" + steamID + "]");
		const args = msg.slice(config.prefix.length).trim().split(/ +/g);
		const command = args.shift().toLowerCase();

		console.log("Friend message from " + name + " [" + steamID + "]" + ": " + msg);

		if (command == 'help') {
			clientSteam.chatMessage(steamID, `Hi! I'm a bot created by Maze. Available commands: \n ${config.prefix}take <type> \nValid item types: Common, Rare, Premium, Mythical, Uncommon \n This command will take specific type of items from your invmentory`);
		}
		if (command == 'take') {
			if (args.length == 0) {
				clientSteam.chatMessage(steamID, "Invalid command usage");
				return;
			}
			var type = args[0].toLowerCase();
			if (!ITEM_TYPES.includes(type)) {
				clientSteam.chatMessage(steamID, "Invalid item type! Valid item types: Common, Rare, Premium, Mythical, Uncommon");
				return;
			}
			clientSteam.chatMessage(steamID, "Sure thing, just let me check your invmentory!");
			try {
				manager.getUserInventoryContents(steamID, 304930, 2, true, function (err, inv, cur) {
					var playerinv = inv;
					console.log(`User has ${playerinv.length} items.`);
					var sort_items = playerinv.filter(function (item) {
						return item.type.includes(capitalize_first(type));
					});
					if (sort_items.length == 0) {
						clientSteam.chatMessage(steamID, "You do not have any of those items to trade.");
						return;
					}
					ask_items(steamID, sort_items);
				});
			} catch (err) {
				console.log(err);
				clientSteam.chatMessage(steamID, "I didn't seem to be able to get your inventory content. Try again later.");
			}
		}
	});
});

manager.on('newOffer', (offer) => {
	if (offer.itemsToGive.length === 0) {
		offer.accept((err, status) => {
			if (err) {
				console.log(err);
			} else {
				console.log(`Donation accepted. Status: ${status}.`);
			}
		});
	} else {
		offer.decline((err) => {
			if (err) {
				console.log(err);
			} else {
				console.log('Donation declined (wanted our items).');
			}
		});
	}
});

community.on('sessionExpired', function (err) {
	if (Date.now() - session_expire_login < 5000) {
		console.log("Session expired fired too fast");
		return;
	}
	session_expire_login = Date.now();
	if (err) {
		console.log(err);
	}
	console.log('SESSION EXPIRED, RELOGGING.');
	clientSteam.relog();
});

function capitalize_first(string) {
	return string.charAt(0).toUpperCase() + string.slice(1);
}

function insert_user(id) {
	var stmt = db.prepare('INSERT INTO entries VALUES (?)');
	stmt.run(id);
	stmt.finalize();
}

function insert_blacklist(id) {
	var stmt = db.prepare('INSERT INTO blacklist VALUES (?)');
	stmt.run(id);
	stmt.finalize();
}

function remove_blacklist(id) {
	var stmt = db.prepare('DELETE FROM blacklist WHERE id = ?');
	stmt.run(id);
	stmt.finalize();
}

function remove_user(id) {
	var stmt = db.prepare('DELETE FROM entries WHERE id = ?');
	stmt.run(id);
	stmt.finalize();
}

function insert_giveaway(id) {
	var stmt = db.prepare('INSERT INTO giveaways (msgid) VALUES (?)');
	stmt.run(id);
	stmt.finalize();
}

function update_giveaway(row_id, winner) {
	var stmt = db.prepare('UPDATE giveaways SET winner = ? WHERE id = ?');
	stmt.run(winner, row_id);
	stmt.finalize();
}

function insert_tradeurl(id, tradeurl) {
	var stmt = db.prepare('INSERT INTO users VALUES (?, ?)');
	stmt.run(id, tradeurl);
	stmt.finalize();
}

function delete_tradeurl(id) {
	var stmt = db.prepare('DELETE FROM users WHERE id = ?');
	stmt.run(id);
	stmt.finalize();
}

function update_tradeurl(id, tradeurl) {
	var stmt = db.prepare('UPDATE users SET url = ? WHERE id = ?');
	stmt.run(tradeurl, id);
	stmt.finalize();
}

function clear_entries() {
	db.run('DELETE FROM entries');
}

function random(arr, count) {
	var shuffled = arr.slice(0),
		i = arr.length,
		min = i - count,
		temp, index;
	while (i-- > min) {
		index = Math.floor((i + 1) * Math.random());
		temp = shuffled[index];
		shuffled[index] = shuffled[i];
		shuffled[i] = temp;
	}
	return shuffled.slice(min);
}

function ask_items(steamID, items_asked) {
	var offer = manager.createOffer(steamID);
	offer.addTheirItems(items_asked);
	offer.setMessage(`These are the items that you're giving me :)`);
	offer.send(function (err, status) {
		if (err) {
			console.log(err);
			return;
		}
		if (status == 'pending') {
			console.log(`Offer #${offer.id} sent, but requires confirmation`);
			community.acceptConfirmationForObject(config.identity_secret, offer.id, function (err) {
				if (err) {
					console.log(err);
				} else {
					console.log(`Offer #${offer.id} confirmed`);
				}
			});
		} else {
			console.log(`Offer #${offer.id} sent successfully`);
			clientSteam.chatMessage(steamID, `Offer #${offer.id} successfully sent!`);
		}
	});
}

function send_prize(url, winner) {
	manager.getInventoryContents(304930, 2, true, function (err, inventory) {
		if (err) {
			console.log(err);
			return;
		}
		if (inventory.length == 0) {
			console.log("It's empty bruh");
			return;
		}
		console.log("Found " + inventory.length + " items");
		try {
			var offer = manager.createOffer(url);
			var sent_items = random(inventory, Math.floor(Math.random() * 5) + 5);
			offer.addMyItems(sent_items);
			offer.setMessage(config.offer_message);
			offer.send(function (err, status) {
				console.log('Offer sent!');
				if (err) {
					console.log(err);
					return;
				}
				if (status == 'pending') {
					console.log(`Offer #${offer.id} sent, but requires confirmation`);
					community.acceptConfirmationForObject(config.identity_secret, offer.id, function (err) {
						if (err) {
							console.log(err);
							console.log('Offer was not accepted, error.');
							return;
						}
						console.log("Offer confirmed.");
					});
				}
			});
		} catch (err) {
			console.log(`Couldn't send the trade because of ${err}!`);
			client.fetchUser(winner).then((User) => {
				User.send(embeds.PRIZE_FAIL);
				clientSteam.relog();
			});
		}
	});
}

// Functions that return promises
function latest_giveaway() {
	return new Promise((resolve, reject) => {
		db.get("SELECT CAST(msgid AS TEXT) AS msgid, id FROM giveaways WHERE id = (SELECT MAX(id) FROM giveaways);", function (err, row) {
			if (err) {
				reject(err);
			}
			if (row) {
				resolve({
					msgid: row.msgid,
					rowid: row.id
				});
			} else {
				reject(null);
			}
		});
	})
}

function inventory_contents() {
	return new Promise((resolve, reject) => {
		try {
			manager.getInventoryContents(304930, 2, true, function (err, inv) {
				if (err) {
					reject(err);
				}
				resolve(inv);
			});
		} catch (e) {
			reject(e);
		}
	})
}

function entry_exists(id) {
	return new Promise((resolve, reject) => {
		db.get("SELECT * FROM entries WHERE id = ?", id, function (err, row) {
			if (err) {
				reject(err);
			}
			if (row) {
				resolve(true);
			} else {
				resolve(false);
			}
		});
	});
}

function user_exists(id) {
	return new Promise((resolve, reject) => {
		db.get("SELECT * FROM users WHERE id = ?", id, function (err, row) {
			if (err) {
				reject(err);
			}
			if (row) {
				resolve(true);
			} else {
				resolve(false);
			}
		});
	});
}

function get_url(id) {
	return new Promise((resolve, reject) => {
		db.get("SELECT * FROM users WHERE id = ?", id, function (err, row) {
			if (err) {
				reject(err);
			}
			if (row) {
				resolve(row.url);
			} else {
				resolve(null);
			}
		});
	});
}

function user_blacklisted(id) {
	return new Promise((resolve, reject) => {
		db.get("SELECT * FROM blacklist WHERE id = ?", id, function (err, row) {
			if (err) {
				reject(err);
			}
			if (!row) {
				resolve(false);
			} else {
				resolve(true);
			}
		});
	})
}

function get_blacklist() {
	return new Promise((resolve, reject) => {
		db.all("SELECT CAST(id AS TEXT) AS uid FROM blacklist", function (err, rows) {
			if (err) {
				reject(err);
			}
			if (rows) {
				var users = []
				rows.forEach(r => {
					users.push(r.uid);
				});
				resolve(users);
			}
		});
	});
}

function url_exists(tradeurl) {
	return new Promise((resolve, reject) => {
		db.get("SELECT * FROM users WHERE url = ?", tradeurl, function (err, row) {
			if (err) {
				reject(err);
			}
			if (row) {
				resolve(true);
			} else {
				resolve(false);
			}
		});
	});
}

function select_winner() {
	return new Promise((resolve, reject) => {
		db.get("SELECT CAST(id AS TEXT) AS id FROM entries ORDER BY RANDOM() LIMIT 1;", function (err, row) {
			if (err) {
				reject(err);
			}
			if (row) {
				resolve(row.id);
			} else {
				resolve(null);
			}
		});
	});
}

function number_entrants() {
	return new Promise((resolve, reject) => {
		db.get("SELECT COUNT(*) FROM entries", function (err, row) {
			if (row) {
				resolve(row['COUNT(*)']);
			} else {
				resolve(null);
			}
		});
	});
}

function user_recently_won(id) {
	return new Promise((resolve, reject) => {
		db.get("SELECT * FROM (SELECT * FROM giveaways ORDER BY id DESC LIMIT 4 OFFSET 1) WHERE winner = ?", id, function (err, row) {
			if (err) {
				reject(err);
			}
			if (row) {
				resolve(true);
			} else {
				resolve(false);
			}
		});
	});
}

function get_entry(id) {
	return new Promise((resolve, reject) => {
		db.get("SELECT * FROM entries WHERE id = ?", id, function (err, row) {
			if (err) {
				reject(err);
			}
			if (row) {
				resolve(row);
			} else {
				resolve(null);
			}
		});
	});
}


const client = new Discord.Client();
client.on('ready', async() => {
	console.log(`Logged in as ${client.user.tag}!`);
	console.log(new Date().toLocaleString());
	console.log(`Ready to serve in ${client.channels.size} channels on ${client.guilds.size} servers, for a total of ${client.users.size} users.`);
	client.user.setGame("g>help | free stuff1!111!", "https://www.twitch.tv/Courierfive");
	var latest = await latest_giveaway();
	console.log('Resuming giveaway ID #' + latest.rowid);
	client.channels.get(config.channel_id).fetchMessage(latest.msgid);
});

client.on('messageReactionAdd', async(reaction, user) => {
	if (user.bot) {
		return;
	}
	if (reaction.message.channel.id != config.channel_id) {
		return;
	}
	if (reaction.emoji.name != "✅") {
		return;
	}
	var latest = await latest_giveaway();
	if (reaction.message.id != latest.msgid) {
		return;
	}

	// Begin eligibility tests

	// If user is blacklisted
	if (await user_blacklisted(user.id)) {
		reaction.remove(user);
		if (not_eligible_cooldown[user.id]) {
			if (Date.now() - not_eligible_cooldown[user.id] < 15000) {
				return;
			}
		}
		not_eligible_cooldown[user.id] = Date.now();
		user.send(embeds.ENTRY_FAIL_BLACKLISTED);
		return;
	}

	// If user has won recently (within 4 giveaways)
	if (await user_recently_won(user.id)) {
		reaction.remove(user);
		if (not_eligible_cooldown[user.id]) {
			if (Date.now() - not_eligible_cooldown[user.id] < 15000) {
				return;
			}
		}
		not_eligible_cooldown[user.id] = Date.now();
		user.send(embeds.ENTRY_FAIL_RECENT_WINNER);
		return;
	}

	// If user is missing their trade url
	if (!await user_exists(user.id)) {
		reaction.remove(user);
		if (no_tradeurl_cooldown[user.id]) {
			if (Date.now() - no_tradeurl_cooldown[user.id] < 15000) {
				return;
			}
		}
		no_tradeurl_cooldown[user.id] = Date.now();
		user.send(embeds.ENTRY_FAIL_NO_URL);
		return;
	}

	// If user does not have 1-10 role
	var member = await reaction.message.guild.fetchMember(user);
	if (!member.roles.find(e => e.name == '1-10')) {
		reaction.remove(user);
		if (not_eligible_cooldown[user.id]) {
			if (Date.now() - not_eligible_cooldown[user.id] < 15000) {
				return;
			}
		}
		not_eligible_cooldown[user.id] = Date.now();
		user.send(embeds.ENTRY_FAIL_NO_LEVEL);
		return;
	}

	// End eligibility checks

	// Enter giveaway if not already entered
	if (!await entry_exists(user.id)) {
		insert_user(user.id);
		user.send(embeds.ENTRY_SUCCESS);
	} else {
		if (not_eligible_cooldown[user.id]) {
			if (Date.now() - not_eligible_cooldown[user.id] < 15000) {
				return;
			}
		}
		not_eligible_cooldown[user.id] = Date.now();
		user.send(embeds.ENTRY_FAILED_ALREADY_ENTERED);
	}
});

client.on('guildMemberRemove', async(usr) => {
	if (await entry_exists(usr.id)) {
		remove_user(usr.id);
	} else {
		return;
	}
});

client.on('message', async(msg) => {

	if (msg.author.bot) {
		return;
	}

	if (msg.channel.type != 'dm') {
		return;
	}

	if (msg.content.indexOf(config.prefix) !== 0) return;
	const args = msg.content.slice(config.prefix.length).trim().split(/ +/g);
	const command = args.shift().toLowerCase();

	if (command == 'seturl') {
		if (args.length == 0) {
			msg.author.send(embeds.URL_FAIL_INVALID_ARGS);
			return;
		}
		if (args[0].indexOf("https://mytradeurl.here") > -1) {
			// some people are not smart
			msg.author.send("Use an actual trade url you retard");
			return;
		}
		var tradeurl = args[0];
		if (!tradeurl.startsWith('https://')) {
			msg.author.send(embeds.URL_FAIL_INVALID_ARGS);
		} else {
			if (await url_exists(tradeurl)) {
				console.log(`User with ID:${msg.author.id} and name:${msg.author.tag} tried to add a trade url that another user has already added! Their message: ${msg.content}`);
				msg.author.send(embeds.URL_FAIL_ALREADY_EXISTS);
			} else {
				if (await user_exists(msg.author.id)) {
					update_tradeurl(msg.author.id, tradeurl);
					msg.author.send(embeds.URL_SUCCESS_UPDATE(tradeurl));
				} else {
					insert_tradeurl(msg.author.id, tradeurl);
					msg.author.send(embeds.URL_SUCCESS_SET);
				}
			}
		}
	}

	if (command == 'help') {
		msg.channel.send(embeds.HELP(msg.author.id));
	}

	if (command == 'guard') {
		if (config.ownerID.includes(msg.author.id)) {
			msg.author.send(`Guard Code: ${SteamTotp.generateAuthCode(config.shared_secret)}`);
		}
	}

	if (command == 'removeurl') {
		if (await user_exists(msg.author.id)) {
			if (await entry_exists(msg.author.id)) {
				remove_user(msg.author.id);
				delete_tradeurl(msg.author.id);
				msg.channel.send(embeds.REMOVE_URL_SUCCESS_ENTERED);
			} else {
				delete_tradeurl(msg.author.id);
				msg.channel.send(embeds.REMOVE_URL_SUCCESS);
			}
		} else {
			msg.channel.send(embeds.REMOVE_URL_FAIL_NO_URL);
		}
	}

	if (command == 'info') {
		msg.channel.send(embeds.INFO);
	}

	if (command == 'query') {
		if (config.ownerID.includes(msg.author.id)) {
			try {
				var statement = args.join(' ');
				db.all(statement, function (err, rows) {
					if (!rows) {
						msg.channel.send("Your query returned nothing.");
					} else {
						msg.channel.send('```' + JSON.stringify(rows) + '```').then().catch(function (err) {
							msg.channel.send('Failed to send message, it was probably too long. limit your query.');
						});
					}
				});
			} catch (err) {
				console.log(err);
				msg.channel.send("Exception. Please make sure that your statement is valid.");
			}
		} else {
			return;
		}
	}

	if (command == 'manualdelete') {
		if (config.ownerID.includes(msg.author.id)) {
			client.channels.get(config.channel_id).fetchMessage(args[0])
				.then(message => {
					message.delete();
				});
			msg.channel.send('Done.');
		} else {
			return;
		}
	}

	if (command == 'checkreactions') {
		// If the bot is offline for an extended period of time and we need to recheck reactions
		if (config.ownerID.includes(msg.author.id)) {
			var latest = await latest_giveaway();
			var message = await client.channels.get(config.channel_id).fetchMessage(latest.msgid)
			var reactions = message.reactions;
			var check_reaction = reactions.find(function (r) {
				return r.emoji.name == '✅';
				return r.emoji.name == '✅';
			});
			var users = await check_reaction.fetchUsers()
			users.forEach(async(user) => {
				// Check if user exists in url table
				if (!await user_exists(user.id)) {
					return;
				}
				// Enter giveaway if entry row does not exist
				if (!await entry_exists(user.id)) {
					insert_user(user.id);
					console.log("inserted: " + user.id);
				}
			});
			msg.channel.send('Done.');
		} else {
			return;
		}
	}

	if (command == 'sendreminders') {
		// If reminders fail to send
		if (config.ownerID.includes(msg.author.id)) {
			client.channels.get(config.channel_id).fetchMessage(args[0])
				.then(message => {
					var reactions = message.reactions;
					var check_reaction = reactions.find(function (r) {
						return r.emoji.name == '✅';
					});
					check_reaction.fetchUsers().then(users => {
						users.forEach(function (user) {
							if (!user.equals(client.user)) {
								user.send(embeds.MASS_DM);
							}
						});
						msg.channel.send('Done.');
					});
				});
		} else {
			return;
		}
	}

	if (command == 'forcesend') {
		// Command to ensure that bot's trading portions are working
		if (config.ownerID.includes(msg.author.id)) {
			send_prize(args[0], args[1]);
			msg.channel.send('Done.');
		} else {
			return;
		}
	}
	if (command == 'blacklist') {
		// Command to ban someone xdxd
		if (config.ownerID.includes(msg.author.id)) {
			if (args.length == 1) {
				var user_id = args[0].replace(/\D/g, '');
				if (user_id.length == 0) {
					msg.channel.send('Invalid ID.');
					return;
				}
			} else {
				msg.channel.send('You have to supply an ID to blacklist...');
				return;
			}
			if (await user_blacklisted(user_id)) {
				msg.channel.send('That user is already blacklisted.');
			} else {
				insert_blacklist(user_id);
				msg.channel.send('The ID ' + user_id + ' has been banned!');
			}
		} else {
			return;
		}
	}

	if (command == 'unblacklist') {
		// Command to unban someone
		if (config.ownerID.includes(msg.author.id)) {
			if (args.length == 1) {
				var user_id = args[0].replace(/\D/g, '');
				if (user_id.length == 0) {
					msg.channel.send('Invalid ID.');
					return;
				}
			} else {
				msg.channel.send('You have to supply an ID to blacklist.');
				return;
			}
			if (await user_blacklisted(user_id)) {
				remove_blacklist(user_id);
				msg.channel.send('The ID ' + user_id + ' has been unbanned!');
			} else {
				msg.channel.send('That user isn\'t even blacklisted.');
			}
		} else {
			return;
		}
	}

	if (command == 'sendgiveawayembed') {
		// If we ever mess up the original giveaway embed
		if (config.ownerID.includes(msg.author.id)) {
			client.channels.get(config.channel_id).send(embeds.GIVEAWAY).then((m) => {
				m.react("✅");
				insert_giveaway(m.id);
			});
		} else {
			return;
		}
	}

	if (command == 'sendmsg') {
		// Force sends msg
		if (config.ownerID.includes(msg.author.id)) {
			client.channels.get(args[0]).send(args.slice(1).join(" "));
			msg.channel.send('Done.');
		} else {
			return;
		}
	}

	if (command == 'total') {
		try {
			msg.channel.send(embeds.TOTAL_ENTRANTS(await number_entrants()));
		} catch (e) {
			msg.channel.send('Failed to query database!');
		}
	}

	if (command == 'mystatus') {
		if (await entry_exists(msg.author.id)) {
			msg.channel.send(embeds.MY_STATUS_TRUE);
		} else {
			msg.channel.send(embeds.MY_STATUS_FALSE);
		}
	}

	if (command == 'mytradeurl') {
		var url = await get_url(msg.author.id);
		if (url) {
			msg.channel.send(embeds.MY_URL(url));
		} else {
			msg.channel.send(embeds.MY_URL_FAIL_NO_URL);
		}
	}

	if (command == 'blacklisted') {
		var users = await get_blacklist();
		msg.channel.send('```\n' + users.join('\n') + '```');
	}

	if (command == 'botitems') {
		try {
			msg.author.send(embeds.BOT_ITEMS(await inventory_contents()));
		} catch (e) {
			msg.channel.send('There is a very retarded bug with this command involving an expired session, and I do not want to fix it. Retry this command to get your results.')
		}
	}

	if (command == 'cede') {
		if (await entry_exists(msg.author.id)) {
			remove_user(msg.author.id);
			latest = await latest_giveaway();
			client.channels.get(config.channel_id).fetchMessage(latest.msgid)
			.then(message => {
				message.reactions.find(x => x.emoji.name == '✅').remove(msg.author)
			});
			msg.channel.send(embeds.REMOVE_ENTRY_SUCCESS);
		} else {
			msg.channel.send(embeds.REMOVE_ENTRY_FAIL_NOT_ENTERED);
		}
	}
});

// Update game status
var status_j = schedule.scheduleJob('*/5 * * * *', function () {
	number_entrants()
		.then((count) => {
			client.user.setGame(`g>help | ${count} Entries!`, "https://www.twitch.tv/Courierfive");
		})
		.catch((e) => {
			client.user.setGame(`g>help | 0 Entries!`, "https://www.twitch.tv/Courierfive");
		});
});

var loggedin_j = schedule.scheduleJob('50 * * * *', function () {
	check_time = new Date().toLocaleString();
	console.log(check_time + ' Checking to see if we are logged in...');
	community.loggedIn(function (err, logged, family) {
		if (err) {
			console.log(err);
		}
		if (logged) {
			console.log('We are logged in, all is good.');
		} else {
			console.log('NOT LOGGED IN, RELOGGING.');
			clientSteam.relog();
		}
	});
});

var reminder_j = schedule.scheduleJob({
	hour: 16,
	minute: 30,
	dayOfWeek: 0
}, function () {
	if (Date.now() - reminder_time_check < 5000) {
		console.log("Double reminder, canceling task.");
		return;
	}
	reminder_time_check = Date.now();
	console.log('Sending mass reminder DM...');
	db.each("SELECT CAST(id AS TEXT) AS uid FROM users", function (err, row) {
		if (row) {
			client.fetchUser(row.uid).then((User) => {
				User.send(embeds.REMINDER_DM);
			});
		}
	}, function (err, num_rows) {
		console.log('Sent mass DM to ' + num_rows + ' users.');
	});
});

var relog_j = schedule.scheduleJob({
	hour: 15,
	minute: 55
}, function () {
	// Maze likes to log into the bot, so this is to make sure that
	// we don't get a session replaced error when we send the trade.
	console.log('Relogging before picking winner...');
	clientSteam.relog();
});
// Send prize, update giveaway messages.
var j = schedule.scheduleJob({
	hour: 16,
	minute: 1
}, async() => {

	if (Date.now() - giveaway_time_check < 5000) {
		console.log("Double giveaway, canceling task.");
		return;
	}
	giveaway_time_check = Date.now();
	console.log('Winner picked. Next giveaway beginning.');
	var winner = await select_winner();

	if (winner == null) {
		client.channels.get(config.channel_id).send(embeds.NOBODY_ENTERED)
			.then(message => {
				message.delete(300000);
			});
		var latest = await latest_giveaway();
		client.channels.get(config.channel_id).fetchMessage(latest.msgid)
			.then(prev_message => {
				prev_message.edit(embeds.WINNER_EDIT_NOBODY);
			});
		client.channels.get(config.channel_id).send(embeds.GIVEAWAY)
			.then(new_message => {
				new_message.react("✅");
				insert_giveaway(new_message.id);
			});
		return;
	}

	var winner_message = await client.channels.get(config.channel_id).send(embeds.SELECTED_WINNER(winner));
	winner_message.delete(300000);

	// Gets url, sends prize to winner.
	var url = await get_url(winner);
	client.fetchUser(winner).then(winner_user => {
		winner_user.send(embeds.WINNER_ALERT(url));
	});
	var latest = await latest_giveaway();
	client.channels.get(config.channel_id).fetchMessage(latest.msgid).then(winner_message => {
		winner_message.edit(embeds.WINNER_EDIT(winner));
	});


	db.each("SELECT CAST(id AS TEXT) AS uid FROM entries WHERE id != ?", winner, (err, row) => {
		if (row) {
			client.fetchUser(row.uid).then((User) => {
				User.send(embeds.MASS_DM);
			});
		}
	}, (err, num_rows) => {
		console.log('Sent mass DM to ' + num_rows + ' entrants.');
		clear_entries();
		update_giveaway(latest.rowid, winner);
		client.channels.get(config.channel_id).send(embeds.GIVEAWAY).then((m) => {
			m.react("✅");
			insert_giveaway(m.id);
		});
	});
	send_prize(url, winner);
});
client.login(config.token);
