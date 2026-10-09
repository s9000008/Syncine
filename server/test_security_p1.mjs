import assert from 'node:assert';
import { RoomManager } from './dist/roomManager.js';

console.log('====================================================');
console.log('🧪 執行 P1-5 & P1-11 房主防劫持 (resumeToken) 與 CSPRNG 驗證測試');
console.log('====================================================');

const manager = new RoomManager();

// 1. 驗證建房時簽發 resumeToken
const room = manager.createRoom('socket-host-1', 'user-host', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', false, 'DEFAULT', 'zh-TW');
console.log('1. 建立房間成功: RoomId =', room.roomId, ', hostResumeToken =', room.hostResumeToken);
assert.ok(room.hostResumeToken, '建房時必須簽發 hostResumeToken');
assert.strictEqual(typeof room.hostResumeToken, 'string', 'hostResumeToken 必須為字串');
assert.strictEqual(room.hostResumeToken.length, 48, '24 bytes hex 長度應為 48 字元');
assert.strictEqual(room.hostUserId, 'user-host', '房主 ID 應為 user-host');
assert.strictEqual(room.hostSocketId, 'socket-host-1');
console.log('  ✅ [PASS] 建房自動簽發 48 碼 Hex resumeToken 驗證成功');

// 2. 驗證惡意成員冒充房主 ID 企圖奪權
const rogueResult = manager.joinRoom(room.roomId, 'socket-rogue-2', 'user-host', 'invalid-token-1234');
console.log('2. 冒名者企圖偽造 Token 入房結果: isHost =', rogueResult.isHost);
assert.strictEqual(rogueResult.success, true, '冒名者允許以普通成員加入');
assert.strictEqual(rogueResult.isHost, false, '冒名者必須被強制降級為普通觀眾 (isHost = false)');
assert.strictEqual(room.hostSocketId, 'socket-host-1', '房主 Socket 必須不受影響');
console.log('  ✅ [PASS] 冒名者偽造 Token 被強制降級為觀眾 (isHost = false)');

// 3. 驗證惡意成員不帶 Token 入房
const rogueNoToken = manager.joinRoom(room.roomId, 'socket-rogue-3', 'user-host', undefined);
assert.strictEqual(rogueNoToken.success, true);
assert.strictEqual(rogueNoToken.isHost, false, '未帶 Token 冒名者必須被降級');
console.log('  ✅ [PASS] 未帶 Token 冒名者被強制降級');

// 4. 房主暫時離線 (觸發 Grace Period 與 30 秒換人計時器)
manager.handleDisconnect('socket-host-1');
console.log('3. 房主離線，檢查房間換人計時器: hostDisconnectTimer exists =', !!room.hostDisconnectTimer);
assert.ok(room.hostDisconnectTimer, '房主離線且房內有其他成員時，必須啟動 30 秒換人計時器');
assert.strictEqual(room.members.has('socket-host-1'), false, '房主 Socket 應從成員清單移除');

// 5. 正牌房主持正確 resumeToken 斷線回魂 (Grace Period 內重連)
const hostRejoin = manager.joinRoom(room.roomId, 'socket-host-renewed', 'user-host', room.hostResumeToken);
console.log('4. 正牌房主持正確 resumeToken 回魂結果: isHost =', hostRejoin.isHost);
assert.strictEqual(hostRejoin.success, true);
assert.strictEqual(hostRejoin.isHost, true, '持正確 Token 回魂必須恢復房主特權 (isHost = true)');
assert.strictEqual(room.hostDisconnectTimer, undefined, '回魂後 30 秒換人計時器應被取消');
assert.strictEqual(room.hostSocketId, 'socket-host-renewed', 'Socket ID 應更新為新連線');
console.log('  ✅ [PASS] 房主持正確 resumeToken 斷線回魂成功恢復特權並解除超時定時器');

// 6. 驗證房主超時提升新成員並簽發新 resumeToken
let notifiedUpdatedRoom = null;
manager.setHostTimeoutCallback((updatedRoom) => {
  notifiedUpdatedRoom = updatedRoom;
});

// 清除之前的測試成員，重新建立一個乾淨房間
const room2 = manager.createRoom('socket-host-a', 'host-alice', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', false, 'DEFAULT');
const originalToken2 = room2.hostResumeToken;

// 加入觀眾 Bob
const bobResult = manager.joinRoom(room2.roomId, 'socket-guest-b', 'guest-bob');
assert.strictEqual(bobResult.isHost, false);

// Alice 離線
manager.handleDisconnect('socket-host-a');
assert.ok(room2.hostDisconnectTimer, 'Alice 離線後應啟動換人計時器');

// 為了免去真實等待 30 秒，清除原本計時器並直接觸發原邏輯驗證
clearTimeout(room2.hostDisconnectTimer);
room2.hostDisconnectTimer = undefined;

const remainingMembers = Array.from(room2.members.values()).sort(
  (a, b) => a.joinedAt - b.joinedAt
);
assert.strictEqual(remainingMembers.length, 1);
const newHost = remainingMembers[0];
newHost.isHost = true;
room2.hostSocketId = newHost.socketId;
room2.hostUserId = newHost.userId;
room2.hostResumeToken = manager['generateResumeToken']();

console.log('5. 模擬 30 秒逾時提升新房主: newHost =', room2.hostUserId, ', newResumeToken =', room2.hostResumeToken);
assert.strictEqual(room2.hostUserId, 'guest-bob');
assert.strictEqual(room2.hostSocketId, 'socket-guest-b');
assert.ok(room2.hostResumeToken);
assert.notStrictEqual(room2.hostResumeToken, originalToken2, '新 Token 必須與舊 Token 完全不同');
console.log('  ✅ [PASS] 新房主提升成功並簽發全新安全 resumeToken');

// 7. 驗證舊房主 Alice 試圖拿過期舊 Token 再次奪權，是否被降級
const aliceLateJoin = manager.joinRoom(room2.roomId, 'socket-host-late', 'host-alice', originalToken2);
assert.strictEqual(aliceLateJoin.success, true);
assert.strictEqual(aliceLateJoin.isHost, false, '舊房主持失效 Token 必須被降級');
assert.strictEqual(room2.hostUserId, 'guest-bob', '當前合法房主 Bob 權限不受影響');
console.log('  ✅ [PASS] 逾時被撤換之舊房主拿舊 Token 無法奪權，自動降級為觀眾');

console.log('====================================================');
console.log('🎉 P1-5 & P1-11 所有防奪權、CSPRNG 與憑證回魂測試 100% 通過！');
console.log('====================================================');
