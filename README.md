# Rise fundraising software
Rise is crowdfunding software built using bitcoin oracle technology to ensure that contributors get their money back if the fundraising goal is not reached

# How does it work?

Create a fundraiser here: [https://supertestnet.github.io/rise-fundraising-software/create.html](https://supertestnet.github.io/rise-fundraising-software/create.html) **NOTE: THE LINK NO LONGER WORKS***

*It no longer works because I am no longer running the oracle server. But you can run it yourself! Instructions are below.

You'll get a sharable link where people can contribute and you can watch your money roll in. The addresses created on the fundraising page are non-custodial bitcoin smart contracts. They allow one of two spending paths: one uses two keys, namely, the fundraiser recipient's key and a key from a trusted oracle -- i.e. my server, or someone else's if it's configured to talk to someone else's server. This spending path allows the fundraiser recipient to take the money only if the oracle lets them. The oracle is only supposed to do this if the fundraiser meets its goal. (That's what index.js does -- it checks if the fundraiser met its goal and then reveals a key to the fundraiser recipient so they can take their money.)

The other spending path is a timelock: if the fundraiser didn't meet its goal, then the oracle should not have revealed the key that lets the fundraiser recipient take the money, so 24 hours after the fundraiser ends, the contributor can take their money back.

# Why did you make this?

Other fundraising software in the bitcoin space is either fully custodial or relies on the hope that no one minds permanently sending money to a fundraiser with no hope of recovery. Some people want a guarantee that they'll get their money back if the fundraiser doesn't reach its goal, so I wanted to provide that in a non-custodial setting.

# Can I install this on my website?

Yes, this software is in the public domain, so you can use it without restrictions -- for commerce or not-for-profit or to evade sanctions or to launder money, whatever you want. The ball is in your court. That's the beauty of open protocols.

If you decide to install this on your website, you'll need nodejs and npm installed. My nodejs version is v16.17.0 and my npm version is 8.15.0. Then clone this repo, go in, and run `npm init` -- hit enter a bunch of times while it prepares your environment, then install these dependencies:

```
npm install ws browserify-cipher noble-secp256k1 bitcoinjs-lib axios crypto fs
```

Now run `node index.js` and you should be good to go. Your private keys are in a file it created called keys.txt in case you want to back those up. Don't delete that file, your private keys are used throughout the app and they are pulled from that file. The app should spit out a nostr pubkey and a signing pubkey in your terminal. Copy those keys and add them to redemption.html -- replace the keys I put in for my instance on lines 425 and 426. Do the same thing on lines 140 and 141 of create.html. Then take just the signing key, go into contribute.html, and replace my key with yours on line 315. Great! Now you are your own oracle. Have fun!
