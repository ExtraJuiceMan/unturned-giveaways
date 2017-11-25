const Discord = require('discord.js');
const config = require("./config.json");

// ENTRY EMBEDS
exports.ENTRY_SUCCESS = new Discord.RichEmbed()
	.setTitle(`Entry Success!`)
	.setColor(0x00FF00)
	.setDescription("You have successfully entered the daily giveaway!" + "\n\nUse `" + config.prefix + "help `" + "for more info")

exports.ENTRY_FAIL_NO_LEVEL = new Discord.RichEmbed()
	.setTitle(`Entry Failed.`)
	.setColor(0xFF0000)
	.setDescription("You are not eligible to enter this giveaway because you do not have the **1-10** role. Talk in our General channel and get to level 1 to enter the giveaway. It only takes a couple of messages!")

exports.ENTRY_FAIL_RECENT_WINNER = new Discord.RichEmbed()
	.setTitle(`Entry Failed.`)
	.setColor(0xFF0000)
	.setDescription("You have won one of the last four giveaways. Give somebody else a chance to win. Check back four days after your win date to enter again!")

exports.ENTRY_FAIL_NO_URL = new Discord.RichEmbed()
	.setTitle(`Entry Failed.`)
	.setColor(0xFF0000)
	.setDescription("It seems like you haven't added your trade url." + " To do that use `" + config.prefix + "seturl https://mytrade.url` " + "\nAfter doing so re-add your reaction to enter the giveaway.\nYou can find your trade URL here: https://steamcommunity.com/id/me/tradeoffers/privacy#trade_offer_access_url\nMake sure you do the command in this DM!")

exports.ENTRY_FAILED_ALREADY_ENTERED = new Discord.RichEmbed()
	.setTitle(`You are already entered.`)
	.setDescription("You are already entered in the current giveaway. ``g>cede`` to unenter.")

// URL EMBEDS
exports.URL_FAIL_ALREADY_EXISTS = new Discord.RichEmbed()
	.setTitle('This trade URL already seems to exist.')
	.setDescription('You do not have to set the URL again after a giveaway.')
	.setColor(0xFF0000)

exports.URL_SUCCESS_SET = new Discord.RichEmbed()
	.setTitle('Your trade URL has been successfully set.')
	.setDescription('Your trade URL has been set!\nNow you can enter giveaways.')
	.setColor(0x00FF00)

exports.URL_FAIL_INVALID_ARGS = new Discord.RichEmbed()
	.setTitle("Invalid arguments/trade URL!")
	.setImage('https://i.imgur.com/PccU0kB.jpg')
	.setColor(0xFF0000)
	.setDescription("Correct usage: ` " + config.prefix + "seturl https://mytrade.url`" + " \n\n\n You can find your trade URL here: https://steamcommunity.com/id/me/tradeoffers/privacy#trade_offer_access_url")

exports.URL_SUCCESS_UPDATE = function(tradeurl) {
	embed = new Discord.RichEmbed()
		.setTitle('Your trade URL has been successfully updated.')
		.setColor(0x00FF00)
		.setDescription(`It has been set to: ${tradeurl}.`)
	return embed;
}

// REMOVE ENTRY EMBEDS

exports.REMOVE_ENTRY_SUCCESS = new Discord.RichEmbed()
	.setTitle(`Success`)
	.setDescription('Your entry has been removed from the current giveaway.')
	.setColor(0x00FF00)

exports.REMOVE_ENTRY_FAIL_NOT_ENTERED = new Discord.RichEmbed()
	.setTitle(`Invalid Operation`)
	.setDescription('You are not entered in the current giveaway.')
	.setColor(0xFF0000)

// REMOVEURL EMBEDS

exports.REMOVE_URL_SUCCESS = new Discord.RichEmbed()
	.setTitle(`Trade URL Successfully Deleted`)
	.setDescription('Your trade URL has been removed from our database')
	.setColor(0x00FF00)

exports.REMOVE_URL_SUCCESS_ENTERED = new Discord.RichEmbed()
	.setTitle(`Trade URL Successfully Deleted`)
	.setDescription('Your trade URL has been removed from our database, and you have been removed from the current giveaway.')
	.setColor(0x00FF00)

exports.REMOVE_URL_FAIL_NO_URL = new Discord.RichEmbed()
	.setTitle(`Invalid Operation`)
	.setDescription('You don\'t even have a trade URL set!')
	.setColor(0xFF0000)

//MYSTATUS EMBEDS

exports.MY_STATUS_TRUE = new Discord.RichEmbed()
	.setTitle(`Yes`)
	.setDescription('You are an entrant in the current giveaway.')

exports.MY_STATUS_FALSE = new Discord.RichEmbed()
	.setTitle(`No`)
	.setDescription('You are not an entrant in the current giveaway.')

//MYURL EMBEDS

exports.MY_URL = function(url) {
	var embed = new Discord.RichEmbed()
		.setTitle(`Your Trade URL`)
		.setDescription(url)
	return embed;
}

exports.MY_URL_FAIL_NO_URL = new Discord.RichEmbed()
	.setTitle(`Invalid Operation`)
	.setDescription('You do not have a trade URL set.')
	.setColor(0xFF0000)

// MISC EMBEDS

exports.HELP = function(authorid) {
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

	if (config.ownerID.includes(authorid)) {
		embed
			.addField('Admin Commands', 'These commands are visible to bot administrators ONLY.')
			.addField(`${config.prefix}query <stmt>`, 'Executes a statement and returns data. Don\'t fuck around with delete statements, THEY WILL SCREW UP THE BOT.')
			.addField(`${config.prefix}forcesend <trade URL>`, 'Force sends a prize trade. Useful for if the initial send_prize trade didn\'t work.')
			.addField(`${config.prefix}manualdelete <msgid>`, 'Manually deletes this bot\'s message. Only works in the giveaway channel.')
			.addField(`${config.prefix}checkreactions`, 'Checks all enter reactions on the giveaway message and adds them to the entry table if they are registered and not already there.');
	}
	embed.setFooter('Bot created by Maze & Extra');
	return embed;
}

exports.INFO = new Discord.RichEmbed()
	.setTitle('Information')
	.addField('Node.js version:', `${process.version}`)
	.addField('Packages used:', `${Object.keys(require('./package.json').dependencies)}`)

exports.BOT_ITEMS = function(items) {
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
	return embed;
}

exports.GIVEAWAY = new Discord.RichEmbed()
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

exports.SELECTED_WINNER = function(winner) {
	var embed = new Discord.RichEmbed()
		.setTitle("Daily Giveaway Results")
		.setImage("https://i.imgur.com/vX9WPTJ.png")
		.setColor(0x36393e)
		.setDescription(`The winner of the daily giveaway is <@${winner}>!\nThe next giveaway will begin shortly.`);
	return embed;
}

exports.WINNER_ALERT = function(url) {
	var embed = new Discord.RichEmbed()
		.setTitle("You won!")
		.setDescription(`Congratulations, you won the giveaway!\nI'll send your your items using the trade URL you supplied.`)
		.addField('Trade URL', url)
		.addField('Notice:', '**You will not be able to enter the next four giveaways**. Give somebody else a chance to win. Check back in four days and you\'ll be able to enter again!')
		.setColor(0x00FF00)
	return embed;
}

exports.WINNER_EDIT = function(winner) {
	var current_time = new Date().toLocaleString();
	var embed = new Discord.RichEmbed()
		.setTitle(`Daily Giveaway`)
		.setDescription(`This giveaway has ended.`)
		.addField(`End Date`, current_time + " (PST)")
		.addField(`Winner`, `<@${winner}>`)
	return embed;
}

exports.TOTAL_ENTRANTS = function(number) {
	var embed = new Discord.RichEmbed()
		.addField('Total Entrants', number)
	return embed;
}

exports.MASS_DM = new Discord.RichEmbed()
	.setTitle('The giveaway has ended!')
	.setDescription('For another chance to win, navigate back to our giveaway channel and enter again!\nYou can get a list of all items up for grabs with ``g>botitems``.');
