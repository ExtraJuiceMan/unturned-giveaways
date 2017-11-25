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

const ITEM_TYPES = ["common", "premium", "mythical", "rare", "uncommon"];
var session_expire_login = 0;
var giveaway_time_check = 0;
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
			clientSteam.chatMessage(steamID, `Hi! I'm a bot created by Maze. Avaiable commands: \n ${config.prefix}take <type> \nValid item types: Common, Rare, Premium, Mythical, Uncommon \n This command will take specific type of items from your invmentory`)
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
					var embed = new Discord.RichEmbed()
						.setTitle(`Entry Failed.`)
						.setColor(0xFF0000)
						.setDescription("It seems like you haven't added your trade url." + " To do that use `" + config.prefix + "seturl https://mytrade.url` " + "\nAfter doing so re-add your reaction to enter the giveaway.\nYou can find your trade URL here: https://steamcommunity.com/id/me/tradeoffers/privacy#trade_offer_access_url\nMake sure you do the command in this DM!")
					user.send(embed);
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
							var embed = new Discord.RichEmbed()
								.setTitle(`Entry Failed.`)
								.setColor(0xFF0000)
								.setDescription("You have won one of the last four giveaways. Give somebody else a chance to win. Check back four days after your win date to enter again!")
							user.send(embed);
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
									var embed = new Discord.RichEmbed()
										.setTitle(`Entry Failed.`)
										.setColor(0xFF0000)
										.setDescription("You are not eligible to enter this giveaway because you do not have the **1-10** role. Talk in our General channel and get to level 1 to enter the giveaway. It only takes a couple of messages!")
									user.send(embed);
								} else {
									insert_user(user.id);
									var embed = new Discord.RichEmbed()
										.setTitle(`Entry Success!`)
										.setColor(0x00FF00)
										.setDescription("You have successfully entered the daily giveaway!" + "\n\nUse `" + config.prefix + "help `" + "for more info")
									user.send(embed);
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
					var embed = new Discord.RichEmbed()
						.setTitle(`You are already entered.`)
						.setDescription("You are already entered in the current giveaway. ``g>cede`` to unenter.")
					user.send(embed);
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
		var invalid_args_embed = new Discord.RichEmbed()
			.setTitle("Invalid arguments/trade URL!")
			.setImage('https://i.imgur.com/PccU0kB.jpg')
			.setColor(0xFF0000)
			.setDescription("Correct usage: ` " + config.prefix + "seturl https://mytrade.url`" + " \n\n\n You can find your trade URL here: https://steamcommunity.com/id/me/tradeoffers/privacy#trade_offer_access_url")
		if (args.length == 0) {
			msg.author.send(invalid_args_embed);
			return;
		}
		var tradeurl = args[0];
		var match = tradeurl.startsWith('https://');
		if (!match) {
			msg.author.send(invalid_args_embed);
		} else {
			url_exists(tradeurl, function(exists) {
				if (exists) {
					console.log(`User with ID:${msg.author.id} and name:${msg.author.tag} tried to add a trade url that another user has already added! Their message: ${msg.content}`);
					var embed = new Discord.RichEmbed()
						.setTitle('This trade URL already seems to exist.')
						.setDescription('You do not have to set the URL again after a giveaway.')
						.setColor(0xFF0000)
					msg.author.send(embed);
				} else {
					var embed = new Discord.RichEmbed()
						.setTitle('Your trade URL has been successfully set.')
						.setDescription('Your trade URL has been set!\nNow you can enter giveaways.')
						.setColor(0x00FF00)
					db.get("SELECT * FROM users WHERE id = ?", msg.author.id, function(err, row) {
						if (row) {
							update_tradeurl(msg.author.id, tradeurl);
							embed.setTitle('Your trade URL has been successfully updated.');
							embed.setColor(0x00FF00)
							embed.setDescription(`It has been set to: ${tradeurl}.`);
							msg.author.send(embed);
						} else {
							insert_tradeurl(msg.author.id, tradeurl);
							msg.author.send(embed);
						}
					});
				}
			});
		}
	}

	if (command == 'help') {
		var embed = new Discord.RichEmbed()
			.setTitle(`Commands`)
			.setDescription('These commands will **only** work in DMs.\nEnsure that you have a trade URL set before entering a giveaway with ``g>seturl <url>``, and ensure that you are entered afterwards with ``g>mystatus.``')
			.addField(`${config.prefix}help`, "It's this command!")
			.addField(`${config.prefix}total`, "Displays total entrants.")
			.addField(`${config.prefix}seturl <url>`, "Use this to add/update your trade URL!")
			.addField(`${config.prefix}removeurl`, "Removes your trade URL from our database. Removes you from the giveaway entry list if you are entered.")
			.addField(`${config.prefix}cede`, "Removes you from the giveaway entry list.")
			.addField(`${config.prefix}botitems`, "Shows items up for grabs.")
			.addField(`${config.prefix}mystatus`, "Checks if you are entered in the current giveaway or not.")
			.addField(`${config.prefix}mytradurl`, "Displays your trade URL, if you have one added.")
			.addField(`${config.prefix}info`, "Information about this bot.");

		if (config.ownerID.includes(msg.author.id)) {
			embed
				.addField('Admin Commands', 'These commands are visible to bot administrators ONLY.')
				.addField(`${config.prefix}query <stmt>`, 'Executes a statement and returns data. Don\'t fuck around with delete statements, THEY WILL SCREW UP THE BOT.')
				.addField(`${config.prefix}forcesend <trade URL>`, 'Force sends a prize trade. Useful for if the initial send_prize trade didn\'t work.')
				.addField(`${config.prefix}manualdelete <msgid>`, 'Manually deletes this bot\'s message. Only works in the giveaway channel.')
				.addField(`${config.prefix}checkreactions`, 'Checks all enter reactions on the giveaway message and adds them to the entry table if they are registered and not already there.');
		}
		embed.setFooter('Bot created by Maze & Extra');
		msg.channel.send(embed);
	}

	if (command == 'removeurl') {
		user_exists(msg.author.id, function(exists) {
			if (exists) {
				entry_exists(msg.author.id, function(user_exists) {
					if (user_exists) {
						remove_user(msg.author.id);
						delete_tradeurl(msg.author.id);
						var embed = new Discord.RichEmbed()
							.setTitle(`Trade URL Successfully Deleted`)
							.setDescription('Your trade URL has been removed from our database, and you have been removed from the current giveaway.')
							.setColor(0x00FF00)
						msg.channel.send(embed);
					} else {
						delete_tradeurl(msg.author.id);
						var embed = new Discord.RichEmbed()
							.setTitle(`Trade URL Successfully Deleted`)
							.setDescription('Your trade URL has been removed from our database')
							.setColor(0x00FF00)
						msg.channel.send(embed);
					}
				});
			} else {
				var embed = new Discord.RichEmbed()
					.setTitle(`Invalid Operation`)
					.setDescription('You don\'t even have a trade URL set!')
					.setColor(0xFF0000)
				msg.channel.send(embed);
			}
		});
	}

	if (command == 'info') {
		var embed = new Discord.RichEmbed()
			.setTitle('Information')
			.addField('Node.js version:', `${process.version}`)
			.addField('Packages used:', `${Object.keys(require('./package.json').dependencies)}`)
		msg.channel.send(embed);
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
			client.channels.get(args[0]).send(args.slice(1, args.length - 1).join(" "));
			msg.channel.send('Done.')
		} else {
			return;
		}
	}

	if (command == 'total') {
		number_entrants(function(number) {
			var embed = new Discord.RichEmbed()
				.addField('Total Entrants', number)
			msg.channel.send(embed);
		});
	}

	if (command == 'mystatus') {
		entry_exists(msg.author.id, function(exists) {
			if (exists) {
				var embed = new Discord.RichEmbed()
					.setTitle(`Yes`)
					.setDescription('You are an entrant in the current giveaway.')
				msg.channel.send(embed);
			} else {
				var embed = new Discord.RichEmbed()
					.setTitle(`No`)
					.setDescription('You are not an entrant in the current giveaway.')
				msg.channel.send(embed);
			}
		});
	}

	if (command == 'mytradeurl') {
		get_url(msg.author.id, function(url) {
			if (url) {
				var embed = new Discord.RichEmbed()
					.setTitle(`Your Trade URL`)
					.setDescription(url)
				msg.channel.send(embed);
			} else {
				var embed = new Discord.RichEmbed()
					.setTitle(`Invalid Operation`)
					.setDescription('You do not have a trade URL set.')
					.setColor(0xFF0000)
				msg.channel.send(embed);
			}
		});
	}

	if (command == 'botitems') {
		inventory_contents(function(items) {
			var embed = new Discord.RichEmbed()
				.setTitle('Bot Items')
				.setDescription('These are the items up for grabs.')
				.addField('Common', items.filter(function(item) {
					return item.type.includes('Common ');
				}).length)
				.addField('Uncommon', items.filter(function(item) {
					return item.type.includes('Uncommon ');
				}).length)
				.addField('Rare', items.filter(function(item) {
					return item.type.includes('Rare ');
				}).length)
				.addField('Premium', items.filter(function(item) {
					return item.type.includes('Premium ');
				}).length)
				.addField('Mythical', items.filter(function(item) {
					return item.type.includes('Mythical ');
				}).length)
			msg.author.send(embed)
		});
	}

	if (command == 'cede') {
		entry_exists(msg.author.id, function(exists) {
			if (exists) {
				remove_user(msg.author.id);
				var embed = new Discord.RichEmbed()
					.setTitle(`Success`)
					.setDescription('Your entry has been removed from the current giveaway.')
					.setColor(0x00FF00)
				msg.channel.send(embed);
			} else {
				var embed = new Discord.RichEmbed()
					.setTitle(`Invalid Operation`)
					.setDescription('You are not entered in the current giveaway.')
					.setColor(0xFF0000)
				msg.channel.send(embed);
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
		var giveaway_embed = new Discord.RichEmbed()
			.setTitle('Daily Giveaway')
			.setDescription('\nEvery 24 hours, a random amount of items is given to a randomly selected winner. These items can be *rare* or even *MEGA-RARE* quality. The process is completely automated.')
			.addField('What should I know before entering? >*IMPORTANT*<', 'You have to have a trade URL set with the bot before entering the giveaway. Send the set trade URL command to the bot **in a DM** to register your trade URL. **Your entry will not be considered if you leave the server.**\n\nCommand Usage:\n``g>seturl https://mytradeurl.here``')
			.addField('Where can I find my trade URL?', 'https://steamcommunity.com/id/me/tradeoffers/privacy#trade_offer_access_url')
			.addField('How do I know if I have successfully entered?', 'The bot will DM you on a successful entry; if it doesn\'t, then something went wrong and your entry wasn\'t acknowledged. Please make sure that server DMs are enabled. You can re-react at a later time if your entry failed.')
			.addField('What if I want to remove my trade URL or leave the giveaway?', '``g>help`` for more information regarding those operations. **The bot will only respond to commands in a DM.**')
			.addField('When does this giveaway end?', 'Do you see the timestamp at the bottom of this message? It ends at the same time on the next day.')
			.addField('Is there anything that makes me ineligible to enter?', '- If you have won a giveaway in the past four days\n- If you are not in the **1-10** role which you can gain by talking.')
			.addField('How is the winner selected?', 'The winner is selected by an ORDER BY RANDOM() query to the entry database. It is completely random.')
			.addField('\u200B', '__*Please read this embed in it\'s entirety before entering.*__\n\n**React with  ✅  to enter the giveaway!**')
			.setFooter('Unturned Giveaway Bot by Maze and Extra')
			.setThumbnail('https://i.imgur.com/LBUxMrF.png')
			.setColor(0x7F9184)
			.setTimestamp();
		if (!winner) {
			var nobody_embed = new Discord.RichEmbed()
				.setTitle("Nobody entered...")
				.setColor(0x36393e)
				.setDescription('It seems like nobody entered the giveaway. Oh well.');
			client.channels.get(config.channel_id).send(nobody_embed).then(message => message.delete(300000));
			latest_giveaway(function(previous_id, row_id) {
				var current_time = new Date().toLocaleString();
				var embed = new Discord.RichEmbed()
					.setTitle(`Daily Giveaway`)
					.setDescription(`This giveaway has ended.`)
					.addField(`End Date`, current_time + " (PST)")
					.addField(`Winner`, `None`)
				client.channels.get(config.channel_id).fetchMessage(previous_id)
					.then(message => {
						message.edit(embed);
						client.channels.get(config.channel_id).send(giveaway_embed).then((m) => {
							m.react("✅");
							insert_giveaway(m.id);
						});
					});
			});
		} else {
			var embed = new Discord.RichEmbed()
				.setTitle("Daily Giveaway Results")
				.setImage("https://i.imgur.com/vX9WPTJ.png")
				.setColor(0x36393e)
				.setDescription(`The winner of the daily giveaway is <@${winner}>!\nThe next giveaway will begin shortly.`);
			client.channels.get(config.channel_id).send(embed).then(message => message.delete(300000))
				.catch(console.error);

			// Gets url, sends prize to winner.
			get_url(winner, function(url) {
				var embed = new Discord.RichEmbed()
					.setTitle("You won!")
					.setDescription(`Congratulations, you won the giveaway!\nI'll send your your items using the trade URL you supplied.`)
					.addField('Trade URL', url)
					.addField('Notice:', '**You will not be able to enter the next four giveaways**. Give somebody else a chance to win. Check back in four days and you\'ll be able to enter again!')
					.setColor(0x00FF00)
				client.fetchUser(winner).then((User) => {
					User.send(embed);
				});
				latest_giveaway(function(previous_id, row_id) {
					var current_time = new Date().toLocaleString();
					var mass_dm = new Discord.RichEmbed()
						.setTitle('The giveaway has ended!')
						.setDescription('For another chance to win, navigate back to our giveaway channel and enter again!\nYou can get a list of all items up for grabs with ``g>botitems``.');
					var embed = new Discord.RichEmbed()
						.setTitle(`Daily Giveaway`)
						.setDescription(`This giveaway has ended.`)
						.addField(`End Date`, current_time + " (PST)")
						.addField(`Winner`, `<@${winner}>`)
					client.channels.get(config.channel_id).fetchMessage(previous_id)
						.then(message => {
							message.edit(embed);
						});
					db.each("SELECT CAST(id AS TEXT) AS uid FROM entries WHERE id != ?", winner, function(err, row) {
						if (row) {
							client.fetchUser(row.uid).then((User) => {
								User.send(mass_dm);
							});
						}
					}, function(err, num_rows) {
						console.log('Sent mass DM to ' + num_rows + ' entrants.');
						clear_entries();
						update_giveaway(row_id, winner);
						client.channels.get(config.channel_id).send(giveaway_embed).then((m) => {
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
