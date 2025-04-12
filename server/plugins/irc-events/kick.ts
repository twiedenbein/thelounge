import {IrcEventHandler} from "../../client";

import log from "../../log";
import Msg from "../../models/msg";

import {MessageType} from "../../../shared/types/msg";
import {ChanState} from "../../../shared/types/chan";

export default <IrcEventHandler>function (irc, network) {
	const client = this;

	irc.on("kick", function (data) {
		const chan = network.getChannel(data.channel!);

		if (typeof chan === "undefined") {
			return;
		}

		const user = chan.getUser(data.kicked!);
		const msg = new Msg({
			type: MessageType.KICK,
			time: data.time,
			from: chan.getUser(data.nick),
			target: user,
			text: data.message || "",
			highlight: data.kicked === irc.user.nick,
			self: data.nick === irc.user.nick,
		});
		chan.pushMessage(client, msg);

		if (data.kicked === irc.user.nick) {
			chan.users = new Map();
			chan.state = ChanState.PARTED;

			client.emit("channel:state", {
				chan: chan.id,
				state: chan.state,
			});
			
			// Auto-rejoin the channel if the setting is enabled for this network
			if (network.autoRejoin) {
				console.log(
					`Auto-rejoining channel ${chan.name} after being kicked by ${data.nick}`
				);
				
				// Add a small delay before rejoining
				setTimeout(() => {
					irc.join(chan.name);
					
					// Notify the user about the auto-rejoin attempt
					const rejoinMsg = new Msg({
						type: MessageType.NOTICE,
						text: `Attempting to automatically rejoin ${chan.name}...`,
					});
					chan.pushMessage(client, rejoinMsg);
				}, 1000); // 1 second delay
			}
		} else {
			chan.removeUser(user);
		}
	});
};
