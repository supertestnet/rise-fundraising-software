var WebSocket = require( 'ws' ).WebSocket;
var browserifyCipher = require( 'browserify-cipher' );
var nobleSecp256k1 = require( 'noble-secp256k1' );
var bitcoinjs = require( 'bitcoinjs-lib' );
var crypto = require( 'crypto' );
var axios = require( 'axios' );
var fs = require( 'fs' );

var privKey = "";
var secret = "";
var socket_id = "";
var num_of_connections = -1;

if ( fs.existsSync( "keys.txt" ) ) {
        var keystext = fs.readFileSync( "keys.txt" ).toString();
        var keys = JSON.parse( keystext );
        privKey = keys[ 0 ];
        secret = keys[ 1 ];
} else {
        privKey = Buffer.from( nobleSecp256k1.utils.randomPrivateKey() ).toString( "hex" );
        secret = Buffer.from( nobleSecp256k1.utils.randomPrivateKey() ).toString( "hex" );
        var keys = [ privKey, secret ];
        var texttowrite = JSON.stringify( keys );
        fs.writeFileSync( "keys.txt", texttowrite, function() {return;});
}

var pubKeyMinus2 = nobleSecp256k1.getPublicKey( privKey, true ).substring( 2 );
var signing_pubkey = nobleSecp256k1.getPublicKey( privKey, true );
console.log( "nostr pubkey:", pubKeyMinus2 );
console.log( "signing pubkey:", signing_pubkey );
var randomid = Buffer.from( nobleSecp256k1.utils.randomPrivateKey() ).toString( "hex" );

var raised_array = {}
var bitcoin_price = 0;

function rmd160( string ) {
        return crypto.createHash( "ripemd160" ).update( string ).digest( "hex" );
}

function sha256( string ) {
        return crypto.createHash( "sha256" ).update( string ).digest( "hex" );
}

function hash160( string ) {
        return rmd160( Buffer.from( sha256( string ), "hex" ) );
}

function normalizeRelayURL(e){let[t,...r]=e.trim().split("?");return"http"===t.slice(0,4)&&(t="ws"+t.slice(4)),"ws"!==t.slice(0,2)&&(t="wss://"+t),t.length&&"/"===t[t.length-1]&&(t=t.slice(0,-1)),[t,...r].join("?")}

function encrypt( privkey, pubkey, text ) {
        var keystext = fs.readFileSync( "keys.txt" ).toString();
        var keys = JSON.parse( keystext );
        privKey = keys[ 0 ];
        var key = nobleSecp256k1.getSharedSecret( privkey, '02' + pubkey, true ).substring( 2 );

        var iv = Uint8Array.from( crypto.randomBytes( 16 ) )
        var cipher = browserifyCipher.createCipheriv(
                'aes-256-cbc',
                Buffer.from( key, 'hex' ),
                iv
        );
        var encryptedMessage = cipher.update( text, "utf8", "base64" );
        emsg = encryptedMessage + cipher.final( "base64" );

        return emsg + "?iv=" + Buffer.from( iv.buffer ).toString( "base64");
}

function decrypt( privkey, pubkey, ciphertext ) {
        var keystext = fs.readFileSync( "keys.txt" ).toString();
        var keys = JSON.parse( keystext );
        privKey = keys[ 0 ];
        var [ emsg, iv ] = ciphertext.split( "?iv=" );
        var key = nobleSecp256k1.getSharedSecret( privkey, '02' + pubkey, true ).substring( 2 );

        var decipher = browserifyCipher.createDecipheriv(
                'aes-256-cbc',
                Buffer.from( key, "hex" ),
                Buffer.from( iv, "base64" )
        );
        var decryptedMessage = decipher.update( emsg, "base64" );
        dmsg = decryptedMessage + decipher.final( "utf8" );

        return dmsg;
}

async function getNote( id ) {
        var relay = "wss://relay.damus.io";
        relay = normalizeRelayURL( relay );
        var socket = new WebSocket( relay );
        var note = "";
        socket.on( 'message', async function( event ) {
                var event = JSON.parse( event );
                if ( event[ 2 ] && event[ 2 ].kind == 4 && event[ 2 ].pubkey == pubKeyMinus2 ) {
                        var i; for ( i=0; i<event[ 2 ].tags.length; i++ ) {
                                if ( event[ 2 ].tags[ i ] && event[ 2 ].tags[ i ][ 1 ] ) {
                                        var recipient = event[ 2 ].tags[ i ][ 1 ];
                                        if ( recipient == pubKeyMinus2 ) {
                                                var decrypted_message = decrypt( privKey, event[ 2 ].pubkey, event[ 2 ].content );
                                                if ( id != event[ 2 ].id ) {
                                                        return;
                                                } else {
                                                        note = ( decrypted_message );
                                                }
                                        } else if ( event[ 2 ].pubkey == pubKeyMinus2 ) {
                                                note = ( decrypt( privKey, recipient, event[ 2 ].content ) );
                                        }
                                }
                        }
                } else if ( event[ 2 ] && ( event[ 2 ].kind == 1 || event[ 2 ].kind == 4239 ) ) {
                        note = ( event[ 2 ].content );
                }
        });
        socket.on( 'open', function open() {
                var filter = {
                        "ids": [
                                id
                        ]
                }
                var subscription = [ "REQ", randomid, filter ];
                subscription = JSON.stringify( subscription );
                var chaser = [ "CLOSE", randomid ];
                chaser = JSON.stringify( chaser );
                socket.send( subscription );
                setTimeout( function() {socket.send( chaser );}, 1000 );
                setTimeout( function() {socket.terminate();}, 2000 );
        });
        async function isNoteSetYet( note_i_seek ) {
                return new Promise( function( resolve, reject ) {
                        if ( note_i_seek == "" ) {
                                setTimeout( async function() {
                                        var msg = await isNoteSetYet( note );
                                        resolve( msg );
                                }, 100 );
                        } else {
                                resolve( note_i_seek );
                        }
                });
        }
        async function getTimeoutData() {
                var note_i_seek = await isNoteSetYet( note );
                return note_i_seek;
        }
        var returnable = await getTimeoutData();
        return returnable;
}

async function sendDM( note, recipient ) {
        var relay = "wss://relay.damus.io";
        relay = normalizeRelayURL( relay );
        var socket = new WebSocket( relay );
        var id = "";
        socket.on( 'open', function open() {
                function makePrivateNote( note, recipientpubkey ) {
                        var now = Math.floor( ( new Date().getTime() ) / 1000 );
                        var privatenote = encrypt( privKey, recipientpubkey, note );
                        var newevent = [
                                0,
                                pubKeyMinus2,
                                now,
                                4,
                                [['p', recipientpubkey]],
                                privatenote
                        ];
                        var message = JSON.stringify( newevent );
                        var msghash = sha256( message );
                        nobleSecp256k1.schnorr.sign( msghash, privKey ).then(
                                value => {
                                        sig = value;
                                        nobleSecp256k1.schnorr.verify(
                                                sig,
                                                msghash,
                                                pubKeyMinus2
                                        ).then(
                                                value => {
                                                        if ( value ) {
                                                                var fullevent = {
                                                                        "id": msghash,
                                                                        "pubkey": pubKeyMinus2,
                                                                        "created_at": now,
                                                                        "kind": 4,
                                                                        "tags": [['p', recipientpubkey]],
                                                                        "content": privatenote,
                                                                        "sig": sig
                                                                }
                                                                var sendable = [ "EVENT", fullevent ];
                                                                sendable = JSON.stringify( sendable );
                                                                socket.send( sendable );
                                                                id = msghash;
                                                                setTimeout( function() {socket.terminate();}, 300 );
                                                         }
                                                }
                                       );
                                }
                        );
                }
                makePrivateNote( note, recipient );
        });
        async function isNoteSetYet( note_i_seek ) {
            return new Promise( function( resolve, reject ) {
                    if ( note_i_seek == "" ) {
                            setTimeout( async function() {
                                    var msg = await isNoteSetYet( id );
                                    resolve( msg );
                            }, 100 );
                    } else {
                            resolve( note_i_seek );
                    }
            });
        }
        async function getTimeoutData() {
            var note_i_seek = await isNoteSetYet( id );
            return note_i_seek;
        }
        var returnable = await getTimeoutData();
        return returnable;
}

async function setPublicNote( note ) {
        var relay = "wss://relay.damus.io";
        relay = normalizeRelayURL( relay );
        var socket = new WebSocket( relay );
        var id = "";
        socket.on( 'open', function open() {
                function makePublicNote( note ) {
                        var now = Math.floor( ( new Date().getTime() ) / 1000 );
                        var newevent = [
                                0,
                                pubKeyMinus2,
                                now,
                                1,
                                [],
                                note
                        ];
                        var message = JSON.stringify( newevent );
                        var msghash = sha256( message );
                        nobleSecp256k1.schnorr.sign( msghash, privKey ).then(
                                value => {
                                        sig = value;
                                        nobleSecp256k1.schnorr.verify(
                                                sig,
                                                msghash,
                                                pubKeyMinus2
                                        ).then(
                                                value => {
                                                        if ( value ) {
                                                                var fullevent = {
                                                                        "id": msghash,
                                                                        "pubkey": pubKeyMinus2,
                                                                        "created_at": now,
                                                                        "kind": 4,
                                                                        "tags": [],
                                                                        "content": note,
                                                                        "sig": sig
                                                                }
                                                                var sendable = [ "EVENT", fullevent ];
                                                                sendable = JSON.stringify( sendable );
                                                                socket.send( sendable );
                                                                id = msghash;
                                                                setTimeout( function() {socket.terminate();}, 300 );
                                                         }
                                                }
                                       );
                                }
                        );
                }
                makePublicNote( note );
        });
        async function isNoteSetYet( note_i_seek ) {
            return new Promise( function( resolve, reject ) {
                    if ( note_i_seek == "" ) {
                            setTimeout( async function() {
                                    var msg = await isNoteSetYet( id );
                                    resolve( msg );
                            }, 100 );
                    } else {
                            resolve( note_i_seek );
                    }
            });
        }
        async function getTimeoutData() {
            var note_i_seek = await isNoteSetYet( id );
            return note_i_seek;
        }
        var returnable = await getTimeoutData();
        return returnable;
}

async function handleMessage( event ) {
        var event = JSON.parse( event );
        if ( event[ 2 ] && ( event[ 2 ].kind == 4 || event[ 2 ].kind == 20004 ) ) {
                //console.log( "tags length:", event[ 2 ].tags.length );
                var i; for ( i=0; i<event[ 2 ].tags.length; i++ ) {
                        //console.log( "tags length:", event[ 2 ].tags.length );
                        if ( event[ 2 ].tags[ i ] && event[ 2 ].tags[ i ][ 1 ] ) {
                                var recipient = event[ 2 ].tags[ i ][ 1 ];
                                console.log( "recipient:", recipient, "my key:", pubKeyMinus2 );
                                if ( recipient == pubKeyMinus2 ) {
                                        var decrypted_message = decrypt( privKey, event[ 2 ].pubkey, event[ 2 ].content );
                                        var note = ( decrypted_message );
                                        console.log( note );
                                        var reply = await handleNote( note, event[ 2 ].pubkey );
                                        console.log( reply );
                                        if ( reply ) {
                                                var id = await sendDM( JSON.stringify( reply ), event[ 2 ].pubkey );
                                                console.log( id );
                                        }
                                }
                        }
                }
        }
}

function openConnection( socket ) {
        console.log( "connected", new Date() );
        num_of_connections = num_of_connections + 1;
        function checkHeartbeat( socket, socket_id_to_test ) {
            heartbeat = false;
            var heartbeatsubId   = Buffer.from( nobleSecp256k1.utils.randomPrivateKey() ).toString( "hex" );
            var heartbeatfilter  = { "ids": [ "41ce9bc50da77dda5542f020370ecc2b056d8f2be93c1cedf1bf57efcab095b0" ] }
            var heartbeatsub     = [ "REQ", heartbeatsubId, heartbeatfilter ];
            if ( socket && socket.readyState != 0 ) {
                    socket.send( JSON.stringify( heartbeatsub ) );
            }
            setTimeout( function() {
                    if ( socket_id_to_test != socket_id ) {
                            socket.terminate();
                            socket.removeAllListeners();
                            //socket.removeEventListener( 'message', handleMessage );
                            //socket.removeEventListener( 'open', function() {openConnection( socket );} );
                    } else if ( !heartbeat && ( socket.readyState == 3 || socket.readyState == 0 ) ) {
                            socket.terminate();
                            socket.removeAllListeners();
                            //socket.removeEventListener( 'message', handleMessage );
                            //socket.removeEventListener( 'open', function() {openConnection( socket );} );
                            var relay = "wss://relay.damus.io";
                            socket = new WebSocket( relay );
                            socket_id = Buffer.from( nobleSecp256k1.utils.randomPrivateKey() ).toString( "hex" );
                            socket.on( 'error', ( error ) => { console.log( error ); });
                            socket.on( 'message', handleMessage );
                            socket.on( 'open', function() {openConnection( socket );} );
                    }
            }, 2000 );
            if ( num_of_connections < 1 ) {
                setTimeout( function() {checkHeartbeat( socket, socket_id );}, 5000 );
            } else {
                num_of_connections = num_of_connections - 1;
            }
        }
        checkHeartbeat( socket, socket_id );
        var filter = {
                "#p": [
                        pubKeyMinus2
                ],
                "since": Math.floor( Date.now() / 1000 ) - ( 60 * 5 )
        }
        var newid = Buffer.from( nobleSecp256k1.utils.randomPrivateKey() ).toString( "hex" );
        var subscription = [ "REQ", newid, filter ];
        subscription = JSON.stringify( subscription );
        socket.send( subscription );
}

async function handlePrivateMessages() {
        var relay = "wss://relay.damus.io";
        relay = normalizeRelayURL( relay );
        var socket = new WebSocket( relay );
        socket_id = Buffer.from( nobleSecp256k1.utils.randomPrivateKey() ).toString( "hex" );
        socket.on( 'error', ( error ) => { console.log( error ); });
        socket.on( 'message', handleMessage );
        socket.on( 'open', function() {openConnection( socket );} );
        doBackgroundTasks( 12 );
}

async function handlePublicMessages( pubkey, subscription_id, oracle_hash, creatorkey, goal, timestamp ) {
        var relay = "wss://relay.damus.io";
        relay = normalizeRelayURL( relay );
        var socket = new WebSocket( relay );
        var subId2   = subscription_id;
        var filter2  = { "#p": [ pubkey ] }
        var subscription2 = [ "REQ", subId2, filter2 ];
        socket.on( 'message', async function( event ) {
                var event = JSON.parse( event );
                if ( event[ 2 ] && event[ 2 ].kind == 4239 ) {
                        var content = event[ 2 ].content;
                        if ( !isValidJson( content ) ) return;
                        var json = JSON.parse( content );
                        if ( json[ "type" ] == "funding info" ) {
                            var pubkey = JSON.parse( content )[ "content" ][ "pubkey" ];
                            var txid = JSON.parse( content )[ "content" ][ "txid" ];
                            var txindex = JSON.parse( content )[ "content" ][ "txindex" ];
                            var contributorkey = pubkey;
                            var real_address = makeFundraiserAddress( timestamp, contributorkey, oracle_hash, creatorkey );
                            var data = await getData( "https://mempool.space/api/tx/" + txid );
                            var claimed_address = data[ "vout" ][ txindex ][ "scriptpubkey_address" ];
                            if ( claimed_address != real_address ) {
                                console.log( "something went very wrong" );
                                return;
                            }
                            var value = data[ "vout" ][ txindex ][ "value" ];
                            console.log( "value:", value );
                            var value_in_dollars = ( satsToBitcoin( value ) * Number( bitcoin_price ) ).toFixed( 2 );
                            console.log( "value in dollars:", value_in_dollars );
                            console.log( "existing value:", raised_array[ subscription_id ][ "raised" ] );
                            raised_array[ subscription_id ] = raised_array[ subscription_id ];
                            raised_array[ subscription_id ][ "raised" ] = Number( raised_array[ subscription_id ][ "raised" ] ) + Number( value_in_dollars );
                            raised_array[ subscription_id ][ "time" ] = Math.floor( Date.now() / 1000 );
                        }
                }
        });
        socket.on( 'open', function open() {
                socket.send( JSON.stringify( subscription2 ) );
        });
        var chaser = [ "CLOSE", randomid ];
        chaser = JSON.stringify( chaser );
        setTimeout( function() {socket.send( chaser );}, 1000 );
        setTimeout( function() {socket.terminate();}, 3000 );
        console.log( "closed" );
}

async function handleNote( content, pubkey ) {
        try {
                var json = JSON.parse( content );
        } catch ( e ) {
                console.log( "bad json:", json );
                return false;  
        }
        var keystext = fs.readFileSync( "keys.txt" ).toString();
        var keys = JSON.parse( keystext );
        privKey = keys[ 0 ];
        secret = keys[ 1 ];
        if ( json[ "type" ] ) {
                var deterministic_secret = nobleSecp256k1.getSharedSecret( secret, '02' + pubkey, true ).substring( 2 );
                var hash = hash160( Buffer.from( deterministic_secret, "hex" ) );
                if ( json[ "type" ] == "init" ) {
                        var msg = `this hash: ${hash} is valid only for the fundraiser created by this pubkey: ${pubkey}`;
                        var msghash = sha256( msg );
                        var sig = await nobleSecp256k1.sign( msghash, privKey );
                        var obj = {}
                        obj[ "hash" ] = hash;
                        obj[ "sig" ] = sig;
                        return obj;
                }
                if ( json[ "type" ] == "over" ) {
                        var contents = await getNote( json[ "event_id" ] );
                        if ( !isValidJson( content ) ) return false;
                        if ( !JSON.parse( contents )[ "goal" ] ) return false;
                        if ( !JSON.parse( contents )[ "timestamp" ] ) return false;
                        if ( typeof( JSON.parse( contents )[ "goal" ] ) != "number" ) return false;
                        if ( typeof( JSON.parse( contents )[ "timestamp" ] ) != "number" ) return false;
                        if ( !JSON.parse( contents )[ "creator_pubkey" ] ) return false;
                        console.log( "raised_array:", raised_array );
                        console.log( "subId2 in raised_array:", subId2 in raised_array );
                        var subId2 = Buffer.from( nobleSecp256k1.utils.randomPrivateKey() ).toString( "hex" );
                        if ( !raised_array[ subId2 ] ) {
                                raised_array[ subId2 ] = [];
                                raised_array[ subId2 ][ "raised" ] = 0;
                                raised_array[ subId2 ][ "time" ] = Math.floor( Date.now() / 1000 );
                        }
                        handlePublicMessages( pubkey, subId2, hash, JSON.parse( contents )[ "creator_pubkey" ], JSON.parse( contents )[ "goal" ], JSON.parse( contents )[ "timestamp" ] );
                        var timeout = await waitSomeSeconds( 5 );
                        console.log( "how much was raised:", raised_array[ subId2 ][ "raised" ] );
                        console.log( "how much was expected:", JSON.parse( contents )[ "goal" ] );
                        if ( raised_array[ subId2 ][ "raised" ] / JSON.parse( contents )[ "goal" ] >= 1 ) {
                                var obj = {}
                                obj[ "preimage" ] = deterministic_secret;
                                return obj;
                        } else {
                                var obj = {}
                                obj[ "error" ] = "Sorry, you did not raise enough money!";
                                return obj;
                        }
                }
                if ( json[ "type" ] == "watch" && json[ "tx" ] && isHex( json[ "tx" ] ) && json[ "tx" ].length < 50000 && json[ "time" ] && typeof( json[ "time" ] ) == "number" && String( json[ "time" ] ).length == 10 ) {
                        var watchtowertext = fs.readFileSync( "watchtower.txt" ).toString();
                        var txs = JSON.parse( watchtowertext );
                        txs.push( [ json[ "tx" ], json[ "time" ] ] );
                        var texttowrite = JSON.stringify( txs );
                        fs.writeFileSync( "watchtower.txt", texttowrite, function() {return;});
                }
        }
        return false;
}

function isHex( string ) {
    regexp = /^[0-9a-fA-F]+$/;
    if ( regexp.test( string ) ) {
        return true;
    } else {
        return false;
    }
}

function isValidJson( content ) {
        try {  
                var json = JSON.parse( content );
        } catch ( e ) {
                return false;  
        }
        return true;
}

function clearArray() {
        Object.keys( raised_array ).forEach( function( key ) {
                if ( Math.floor( Date.now() / 1000 ) > raised_array[ key ][ "time" ] + 180 ) {
                        delete raised_array[ key ];
                } else {
                        console.log( raised_array[ key ][ "time" ] + 180 - Math.floor( Date.now() / 1000 ) );
                }
        });
}

function watchTower() {
        if ( fs.existsSync( "watchtower.txt" ) ) {
                var watchtowertext = fs.readFileSync( "watchtower.txt" ).toString();
                var txs = JSON.parse( watchtowertext );
        } else {
                var txs = [];
                var texttowrite = JSON.stringify( txs );
                fs.writeFileSync( "watchtower.txt", texttowrite, function() {return;});
        }
        var now = Math.floor( Date.now() / 1000 );
        var i; for ( i=0; i<txs.length; i++ ) {
                if ( now > txs[ i ][ 1 ] + 86400 ) {
                        pushBTCpmt( txs[ i ][ 0 ] );
                        txs.splice( i, 1 );
                        var texttowrite = JSON.stringify( txs );
                        fs.writeFileSync( "watchtower.txt", texttowrite, function() {return;});
                        break;
                } else {
                        console.log( txs[ i ][ 1 ] + 86400 - now );
                }
        }
}

async function doBackgroundTasks( i ) {
        clearArray();
        //check bitcoin's price every 60 seconds
        if ( i == 12 ) {
                bitcoin_price = await getBitcoinPrice();
                i = 0;
        } else {
                i = i + 1;
        }
        watchTower();
        setTimeout( function() {doBackgroundTasks( i );}, 5000 );
}

    function generateFundraiserScript( timestamp, contributorkey, oracle_hash, creatorkey ) {
        var script = bitcoinjs.script.fromASM(
            makeFundraiserScript( timestamp, contributorkey, oracle_hash, creatorkey )
            .trim()
            .replace(/\s+/g, ' '),
        );
        return script;
    }
    function makeFundraiserScript( timestamp, contributorkey, oracle_hash, creatorkey ) {
        var scr = `
            OP_IF
                ${ bitcoinjs.script.number.encode( timestamp ).toString( 'hex' ) }
                OP_CHECKLOCKTIMEVERIFY
                OP_DROP
                ${ contributorkey }
            OP_ELSE
                OP_HASH160
                ${ oracle_hash }
                OP_EQUALVERIFY
                ${ creatorkey }
            OP_ENDIF
            OP_CHECKSIG
        `.replace( '\n', '' ).replace( / /g, '' );
        return scr;
    }
    function makeFundraiserAddress( timestamp, contributorkey, oracle_hash, creatorkey ) {
        //make sure everyone gets their money back 24 hours after the fundraiser ends if the oracle does not let the winner win
        var p2wsh = bitcoinjs.payments.p2wsh({redeem: {output: generateFundraiserScript( timestamp, contributorkey, oracle_hash, creatorkey ), network: bitcoinjs.networks.mainnet}, network: bitcoinjs.networks.mainnet });
        return p2wsh.address;
    }

function getData( url ) {
        return new Promise( function( resolve, reject ) {
                axios
                .get( url )
                .then( res => {
                        resolve( res.data );
                }).catch( function( error ) {
                        console.log( error.message );
                });
        });
}

function postData( url, json ) {
        return new Promise( function( resolve, reject ) {
                axios.post( url, json )
                .then( res => {
                        resolve( res.data );
                }).catch( function( error ) {
                        console.log( error.message );
                });
        });
}

async function pushBTCpmt( rawtx ) {
        var success = await postData( "https://mempool.space/api/tx/", rawtx );
        console.log( success );
        return success;
}

function satsToBitcoin( sats ) {
        return "0." + String( sats ).padStart( 8, "0" );
}

async function getBitcoinPrice() {
        var data = await getData( "https://api.coinbase.com/v2/prices/BTC-USD/spot" );
        var json = data;
        var price = json[ "data" ][ "amount" ];
        return price;
}

function waitSomeSeconds( num ) {
        var num = num.toString() + "000";
        num = Number( num );
        return new Promise( function( resolve, reject ) {
                setTimeout( function() { resolve( "" ); }, num );
        });
}

handlePrivateMessages();
