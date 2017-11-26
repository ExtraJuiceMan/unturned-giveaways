const Discord = require('discord.js');
const fs = require('fs');
const schedule = require('node-schedule');
const sqlite3 = require('sqlite3').verbose();
var SteamUser = require('steam-user');
var SteamCommunity = require('steamcommunity');
var SteamTotp = require('steam-totp');
var TradeOfferManager = require('steam-tradeoffer-manager');
const config = require("./config.json");
const db = new sqlite3.Database('./data.db');
const embeds = require("./giveaway_embeds.js");

const ITEM_TYPES = ["common", "premium", "mythical", "rare", "uncommon"];
var session_expire_login = 0;
var giveaway_time_check = 0;
var reminder_time_check = 0;
var not_eligible_cooldown = {};
var no_tradeurl_cooldown = {};

db.serialize(function() {
	db.run("CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, url TEXT)");
	db.run("CREATE TABLE IF NOT EXISTS entries(id INTEGER PRIMARY KEY)");
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
clientSteam.on('loggedOn', function() {
	console.log(`Logged into Steam as: ${config.account_name}`);
	clientSteam.setPersona(SteamUser.Steam.EPersonaState.Online);
	clientSteam.gamesPlayed({
		"game_id": 304930,
		"game_extra_info": "Unturned"
	});
});

clientSteam.on('webSession', function(sessionID, cookies) {
	console.log('Logging into Steam websession and setting cookies...')
	community.setCookies(cookies);
	manager.setCookies(cookies, function(err) {
		if (err) {
			console.log(err);
			process.exit(1); // Fatal error since we couldn't get our API key
			return;
		}
		console.log('Done!');
	});
});

clientSteam.on("friendMessage", function(steamID, msg) {
	if (msg.indexOf(config.prefix) !== 0) {
		return;
	}
	clientSteam.getPersonas([steamID], function(personas) {
		var persona = personas[steamID];
		var name = persona ? persona.player_name : ("[" + steamID + "]");
		const args = msg.slice(config.prefix.length).trim().split(/ +/g);
		const command = args.shift().toLowerCase();

		console.log("Friend message from " + name + " [" + steamID + "]" + ": " + msg);

		if (command == 'ping') {
			clientSteam.chatMessage(steamID, "Pong!");
		}
		if (command == 'help') {
			clientSteam.chatMessage(steamID, `Hi! I'm a bot created by Maze. Available commands: \n ${config.prefix}take <type> \nValid item types: Common, Rare, Premium, Mythical, Uncommon \n This command will take specific type of items from your invmentory`)
		}
		if (command == 'take') {
			if (args.length == 0) {
				clientSteam.chatMessage(steamID, "Invalid command usage");
			} else {
				var type = args[0].toLowerCase();
				var amount = args[1];
				var match = ITEM_TYPES.includes(type);
				if (!match) {
					clientSteam.chatMessage(steamID, "Invalid item type! Valid item types: Common, Rare, Premium, Mythical, Uncommon");
					return;
				} else {
					clientSteam.chatMessage(steamID, "Sure thing, just let me check your invmentory!");
					try {
						manager.getUserInventoryContents(steamID, 304930, 2, true, function(err, inv, cur) {
							var playerinv = inv;
							console.log(`User has ${playerinv.length} items.`)
							var sort_items = playerinv.filter(function(item) {
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
						clientSteam.chatMessage(steamID, "Sorry, but I failed to get your invmentory content! :(")
					}
				}
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

community.on('sessionExpired', function(err) {
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

function inventory_contents(callback) {
	try {
		manager.getInventoryContents(304930, 2, true, function(err, inv) {
			callback(inv);
			if (err) {
				console.log(err);
			}
		});
	} catch (error) {
		callback(null);
	}
}

function insert_user(id) {
	var stmt = db.prepare('INSERT INTO entries VALUES (?)');
	stmt.run(id)
	stmt.finalize();
}

function remove_user(id) {
	var stmt = db.prepare('DELETE FROM entries WHERE id = ?');
	stmt.run(id)
	stmt.finalize();
}

function insert_giveaway(id) {
	var stmt = db.prepare('INSERT INTO giveaways (msgid) VALUES (?)');
	stmt.run(id)
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
	offer.send(function(err, status) {
		if (err) {
			console.log(err);
			return;
		}
		if (status == 'pending') {
			console.log(`Offer #${offer.id} sent, but requires confirmation`);
			community.acceptConfirmationForObject(config.identity_secret, offer.id, function(err) {
				if (err) {
					console.log(err);
				} else {
					console.log(`Offer #${offer.id} confirmed`);
				}
			});
		} else {
			console.log(`Offer #${offer.id} sent successfully`);
			clientSteam.chatMessage(steamID, `Offer #${offer.id} successfully sent!`)
		}
	});
}

function send_prize(url) {
	manager.getInventoryContents(304930, 2, true, function(err, inventory) {
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
			var sent_items = random(inventory, Math.floor(Math.random() * 5) + 5)
			offer.addMyItems(sent_items);
			offer.setMessage(config.offer_message);
			offer.send(function(err, status) {
				console.log('Offer sent!')
				if (err) {
					console.log(err);
					return;
				}
				if (status == 'pending') {
					console.log(`Offer #${offer.id} sent, but requires confirmation`);
					community.acceptConfirmationForObject(config.identity_secret, offer.id, function(err) {
						if (err) {
							console.log(err);
							console.log('Offer was not accepted, error.')
							return;
						} else {
							console.log("Offer confirmed.");
						}
					});
				}
			});

		} catch (err) {
			console.log(`Couldn't send the trade because of ${err}!`);
			var embed = new Discord.RichEmbed()
				.setTitle("Oh no!")
				.setColor(0xFF0000)
				.setDescription("Either your trade URL was invalid, or something went wrong on our end. The trade was not sent successfully.\n\n Please contact staff about this.")
			client.fetchUser(winner).then((User) => {
				User.send(embed);
				clientSteam.relog();
			});
		}
	});
}

// Functions w/ callbacks
function latest_giveaway(callback) {
	db.get("SELECT CAST(msgid AS TEXT) AS msgid, id FROM giveaways WHERE id = (SELECT MAX(id) FROM giveaways);", function(err, row) {
		if (row) {
			callback(row.msgid, row.id);
		} else {
			callback(null, null);
		}
	});
}

function entry_exists(id, callback) {
	db.get("SELECT * FROM entries WHERE id = ?", id, function(err, row) {
		var exists = false;
		if (row) {
			exists = true;
		}
		callback(exists);
	});
}

function user_exists(id, callback) {
	db.get("SELECT * FROM users WHERE id = ?", id, function(err, row) {
		var exists = false;
		if (row) {
			exists = true;
		}
		callback(exists);
	});
}

function get_url(id, callback) {
	db.get("SELECT * FROM users WHERE id = ?", id, function(err, row) {
		if (!row) {
			callback(null);
		} else {
			callback(row.url);
		}
	});
}

function url_exists(tradeurl, callback) {
	db.get("SELECT * FROM users WHERE url = ?", tradeurl, function(err, row) {
		var exists = false;
		if (row) {
			exists = true;
		}
		callback(exists);
	});
}

function select_winner(callback) {
	db.get("SELECT CAST(id AS TEXT) AS id FROM entries ORDER BY RANDOM() LIMIT 1;", function(err, row) {
		if (row) {
			callback(row.id);
		} else {
			callback(null);
		}
	});
}

function number_entrants(callback) {
	db.get("SELECT COUNT(*) FROM entries", function(err, row) {
		if (row) {
			callback(row['COUNT(*)']);
		} else {
			callback(null);
		}
	});
}

const client = new Discord.Client();
client.on('ready', () => {
	console.log(`Logged in as ${client.user.tag}!`);
	console.log(new Date().toLocaleString());
	console.log(`Ready to serve in ${client.channels.size} channels on ${client.guilds.size} servers, for a total of ${client.users.size} users.`);
	client.user.setGame("g>help | free stuff1!111!", "https://www.twitch.tv/Courierfive")
	latest_giveaway(function(msgid, row_id) {
		console.log('Resuming giveaway ID #' + msgid);
		client.channels.get(config.channel_id).fetchMessage(msgid);
	});
});

client.on('messageReactionAdd', (reaction, user) => {
	if (user.bot) {
		return;
	}
	if (reaction.message.channel.id != config.channel_id) {
		return;
	}
	if (reaction.emoji.name != "✅") {
		return;
	}
	latest_giveaway(function(msgid, row_id) {
		if (reaction.message.id != msgid) {
			return;
		}
		db.get("SELECT * FROM entries WHERE id = ?", user.id, function(err, row) {
			user_exists(user.id, function(user_exists) {
				// Check if user exists in url table
				if (!user_exists) {
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
				// Enter giveaway if row does not exist
				if (!row) {
					db.get("SELECT * FROM (SELECT * FROM giveaways ORDER BY id DESC LIMIT 4 OFFSET 1) WHERE winner = ?", user.id, function(err, row) {
						if (row) {
							reaction.remove(user);
							if (not_eligible_cooldown[user.id]) {
								if (Date.now() - not_eligible_cooldown[user.id] < 15000) {
									return;
								}
							}
							not_eligible_cooldown[user.id] = Date.now();
							user.send(embeds.ENTRY_FAIL_RECENT_WINNER);
						} else {
							reaction.message.guild.fetchMember(user).then(function(member) {
								if (!member.roles.find(e => e.name == '1-10')) {
									reaction.remove(user);
									if (not_eligible_cooldown[user.id]) {
										if (Date.now() - not_eligible_cooldown[user.id] < 15000) {
											return;
										}
									}
									not_eligible_cooldown[user.id] = Date.now();
									user.send(embeds.ENTRY_FAIL_NO_LEVEL);
								} else {
									insert_user(user.id);
									user.send(embeds.ENTRY_SUCCESS);
								}
							});
						}
					});
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
		});
	});
});

client.on('guildMemberRemove', usr => {
	entry_exists(usr.id, function(exists) {
		if (exists) {
			remove_user(usr.id);
		} else {
			return;
		}
	});
});

client.on('message', msg => {

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
		var tradeurl = args[0];
		var match = tradeurl.startsWith('https://');
		if (!match) {
			msg.author.send(embeds.URL_FAIL_INVALID_ARGS);
		} else {
			url_exists(tradeurl, function(exists) {
				if (exists) {
					console.log(`User with ID:${msg.author.id} and name:${msg.author.tag} tried to add a trade url that another user has already added! Their message: ${msg.content}`);
					msg.author.send(embeds.URL_FAIL_ALREADY_EXISTS);
				} else {
					db.get("SELECT * FROM users WHERE id = ?", msg.author.id, function(err, row) {
						if (row) {
							update_tradeurl(msg.author.id, tradeurl);
							msg.author.send(embeds.URL_SUCCESS_UPDATE(tradeurl));
						} else {
							insert_tradeurl(msg.author.id, tradeurl);
							msg.author.send(embeds.URL_SUCCESS_SET);
						}
					});
				}
			});
		}
	}

	if (command == 'help') {
		msg.channel.send(embeds.HELP(msg.author.id));
	}

	if (command == 'removeurl') {
		user_exists(msg.author.id, function(exists) {
			if (exists) {
				entry_exists(msg.author.id, function(user_exists) {
					if (user_exists) {
						remove_user(msg.author.id);
						delete_tradeurl(msg.author.id);
						msg.channel.send(embeds.REMOVE_URL_SUCCESS_ENTERED);
					} else {
						delete_tradeurl(msg.author.id);
						msg.channel.send(embeds.REMOVE_URL_SUCCESS);
					}
				});
			} else {
				msg.channel.send(embeds.REMOVE_URL_FAIL_NO_URL);
			}
		});
	}

	if (command == 'info') {
		msg.channel.send(embeds.INFO);
	}

	if (command == 'query') {
		if (config.ownerID.includes(msg.author.id)) {
			try {
				var statement = args.join(' ');
				db.all(statement, function(err, rows) {
					if (!rows) {
						msg.channel.send("Your query returned nothing.")
					} else {
						msg.channel.send('```' + JSON.stringify(rows) + '```').then().catch(function(err) {
							msg.channel.send('Failed to send message, it was probably too long. limit your query.')
						});
					}
				});
			} catch (err) {
				console.log(err);
				msg.channel.send("Exception. Please make sure that your statement is valid.")
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
			latest_giveaway(function(msgid, row_id) {
				client.channels.get(config.channel_id).fetchMessage(msgid)
					.then(message => {
						var reactions = message.reactions;
						check_reaction = reactions.find(function(r) {
							return r.emoji.name == '✅';
						});
						check_reaction.fetchUsers().then(users => {
							users.forEach(function(user) {
								db.get("SELECT * FROM entries WHERE id = ?", user.id, function(err, row) {
									user_exists(user.id, function(user_exists) {
										// Check if user exists in url table
										if (!user_exists) {
											return;
										}
										// Enter giveaway if row does not exist
										if (!row) {
											insert_user(user.id);
											console.log("inserted: " + user.id);
										}
									});
								});
							});
							msg.channel.send('Done.');
						});
					});
			});
		} else {
			return;
		}
	}

	if (command == 'forcesend') {
		// Command to ensure that bot's trading portions are working
		if (config.ownerID.includes(msg.author.id)) {
			send_prize(args[0]);
			msg.channel.send('Done.')
		} else {
			return;
		}
	}

	if (command == 'sendmsg') {
		// Force sends msg
		if (config.ownerID.includes(msg.author.id)) {
			client.channels.get(args[0]).send(args.slice(1).join(" "));
			msg.channel.send('Done.')
		} else {
			return;
		}
	}

	if (command == 'total') {
		number_entrants(function(number) {
			msg.channel.send(embeds.TOTAL_ENTRANTS(number));
		});
	}

	if (command == 'mystatus') {
		entry_exists(msg.author.id, function(exists) {
			if (exists) {
				msg.channel.send(embeds.MY_STATUS_TRUE);
			} else {
				msg.channel.send(embeds.MY_STATUS_FALSE);
			}
		});
	}

	if (command == 'mytradeurl') {
		get_url(msg.author.id, function(url) {
			if (url) {
				msg.channel.send(embeds.MY_URL(url));
			} else {
				msg.channel.send(embeds.MY_URL_FAIL_NO_URL);
			}
		});
	}

	if (command == 'botitems') {
		inventory_contents(function(items) {
			msg.author.send(embeds.BOT_ITEMS(items))
		});
	}

	if (command == 'cede') {
		entry_exists(msg.author.id, function(exists) {
			if (exists) {
				remove_user(msg.author.id);
				msg.channel.send(embeds.REMOVE_ENTRY_SUCCESS);
			} else {
				msg.channel.send(embeds.REMOVE_ENTRY_FAIL_NOT_ENTERED);
			}
		});
	}
});

// Update game status
var status_j = schedule.scheduleJob('*/5 * * * *', function() {
	number_entrants(function(count) {
		if (count) {
			client.user.setGame(`g>help | ${count} Entries!`, "https://www.twitch.tv/Courierfive")
		} else {
			client.user.setGame(`g>help | 0 Entries!`, "https://www.twitch.tv/Courierfive")
		}
	});
});

var loggedin_j = schedule.scheduleJob('50 * * * *', function() {
	check_time = new Date().toLocaleString();
	console.log(check_time + ' Checking to see if we are logged in...');
	community.loggedIn(function(err, logged, family) {
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
	hour: 17,
	minute: 30,
	dayOfWeek: 0
}, function() {
	if (Date.now() - reminder_time_check < 5000) {
		console.log("Double reminder, canceling task.");
		return;
	}
	reminder_time_check = Date.now();
	console.log('Sending mass reminder DM...');
	db.each("SELECT CAST(id AS TEXT) AS uid FROM users", function(err, row) {
		if (row) {
			client.fetchUser(row.uid).then((User) => {
				User.send(embeds.REMINDER_DM);
			});
		}
	}, function(err, num_rows) {
		console.log('Sent mass DM to ' + num_rows + ' users.');
	});
});

var relog_j = schedule.scheduleJob({
	hour: 15,
	minute: 55
}, function() {
	// Maze likes to log into the bot, so this is to make sure that
	// we don't get a session replaced error when we send the trade.
	console.log('Relogging before picking winner...');
	clientSteam.relog();
});
// Send prize, update giveaway messages.
var j = schedule.scheduleJob({
	hour: 16,
	minute: 01
}, function() {
	if (Date.now() - giveaway_time_check < 5000) {
		console.log("Double giveaway, canceling task.");
		return;
	}
	giveaway_time_check = Date.now();
	console.log('Winner picked. Next giveaway beginning.');
	select_winner(function(winner) {
		if (!winner) {
			client.channels.get(config.channel_id).send(embeds.NOBODY_ENTERED).then(message => message.delete(300000));
			latest_giveaway(function(previous_id, row_id) {
				client.channels.get(config.channel_id).fetchMessage(previous_id)
					.then(message => {
						message.edit(embeds.WINNER_EDIT_NOBODY);
						client.channels.get(config.channel_id).send(embeds.GIVEAWAY).then((m) => {
							m.react("✅");
							insert_giveaway(m.id);
						});
					});
			});
		} else {
			client.channels.get(config.channel_id).send(embeds.SELECTED_WINNER(winner)).then(message => message.delete(300000))
				.catch(console.error);

			// Gets url, sends prize to winner.
			get_url(winner, function(url) {
				client.fetchUser(winner).then((User) => {
					User.send(embeds.WINNER_ALERT(url));
				});
				latest_giveaway(function(previous_id, row_id) {
					client.channels.get(config.channel_id).fetchMessage(previous_id)
						.then(message => {
							message.edit(embeds.WINNER_EDIT(winner));
						});
					db.each("SELECT CAST(id AS TEXT) AS uid FROM entries WHERE id != ?", winner, function(err, row) {
						if (row) {
							client.fetchUser(row.uid).then((User) => {
								User.send(embeds.MASS_DM);
							});
						}
					}, function(err, num_rows) {
						console.log('Sent mass DM to ' + num_rows + ' entrants.');
						clear_entries();
						update_giveaway(row_id, winner);
						client.channels.get(config.channel_id).send(embeds.GIVEAWAY).then((m) => {
							m.react("✅");
							insert_giveaway(m.id);
						});
					});
				});
				send_prize(url);
			});
		}
	});
});
client.login(config.token);
