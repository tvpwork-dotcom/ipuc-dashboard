/**
 * Users.gs — จัดการผู้ใช้: อนุมัติ / ปฏิเสธ / ระงับ / เปลี่ยนสิทธิ์
 *
 * กฎสิทธิ์ (ตรวจที่ Backend ทุกครั้ง)
 * - ADMIN จัดการได้เฉพาะผู้ใช้ VIEWER / EDITOR และกำหนดสิทธิ์ได้ไม่เกิน EDITOR
 * - SUPER_ADMIN เท่านั้นที่จัดการบัญชี ADMIN / SUPER_ADMIN หรือกำหนดสิทธิ์ ADMIN ขึ้นไป
 * - ห้ามจัดการบัญชีของตนเอง
 * - ต้องมี SUPER_ADMIN ที่อนุมัติแล้วอย่างน้อย 1 บัญชีเสมอ
 */

var PRIVILEGED_ROLES = ['ADMIN', 'SUPER_ADMIN'];

function findUserByEmail_(email) {
  var target = normalizeEmail_(email);
  if (!target) return null;
  var rows = readTable_('Users').rows;
  for (var i = 0; i < rows.length; i++) {
    if (normalizeEmail_(rows[i].email) === target) return rows[i];
  }
  return null;
}

function updateUserFields_(userId, fields) {
  return withLock_(function () {
    var table = readTable_('Users');
    var row = null;
    table.rows.forEach(function (r) {
      if (r.user_id === userId) row = r;
    });
    if (!row) return null;
    Object.keys(fields).forEach(function (k) { row[k] = fields[k]; });
    updateRows_(table, [row]);
    return row;
  });
}

function assertCanManage_(actor, target, action, newRole, table) {
  if (normalizeEmail_(actor.email) === normalizeEmail_(target.email)) {
    throw apiError_('FORBIDDEN', 'ไม่สามารถจัดการบัญชีของตนเองได้');
  }
  if (actor.role !== 'SUPER_ADMIN') {
    if (PRIVILEGED_ROLES.indexOf(target.role) !== -1) {
      throw apiError_('FORBIDDEN', 'เฉพาะ SUPER_ADMIN เท่านั้นที่จัดการบัญชี ADMIN ได้');
    }
    if (newRole && PRIVILEGED_ROLES.indexOf(newRole) !== -1) {
      throw apiError_('FORBIDDEN', 'เฉพาะ SUPER_ADMIN เท่านั้นที่กำหนดสิทธิ์ ADMIN ขึ้นไปได้');
    }
  }
  var removesSuper = target.role === 'SUPER_ADMIN' && target.status === 'approved' &&
    (action === 'suspend' || action === 'reject' || (action === 'changeRole' && newRole !== 'SUPER_ADMIN'));
  if (removesSuper) {
    var others = table.rows.filter(function (r) {
      return r.user_id !== target.user_id && r.role === 'SUPER_ADMIN' && r.status === 'approved';
    }).length;
    if (others === 0) throw apiError_('FORBIDDEN', 'ต้องมี SUPER_ADMIN ที่ใช้งานได้อย่างน้อย 1 บัญชี');
  }
}

function assertStatusTransition_(target, action) {
  var allowed = {
    approve: ['pending', 'rejected', 'suspended'],
    reject: ['pending'],
    suspend: ['approved'],
    changeRole: ['pending', 'approved', 'suspended', 'rejected']
  }[action];
  if (allowed.indexOf(target.status) === -1) {
    var messages = {
      approve: 'ผู้ใช้นี้ได้รับการอนุมัติอยู่แล้ว',
      reject: 'ปฏิเสธได้เฉพาะผู้ใช้ที่รออนุมัติ',
      suspend: 'ระงับได้เฉพาะผู้ใช้ที่อนุมัติแล้ว'
    };
    throw apiError_('VALIDATION_ERROR', messages[action] || 'สถานะผู้ใช้ไม่ถูกต้อง');
  }
}

function canDo_(actor, target, action, newRole, table) {
  try {
    assertStatusTransition_(target, action);
    assertCanManage_(actor, target, action, newRole, table);
    return true;
  } catch (e) {
    return false;
  }
}

function assignableRoles_(actor) {
  return actor.role === 'SUPER_ADMIN' ? ROLES.slice() : ['VIEWER', 'EDITOR'];
}

function adminUserView_(row, actor, table) {
  var user = stripInternal_(row);
  user.full_name = (String(row.first_name || '') + ' ' + String(row.last_name || '')).trim();
  user.is_self = normalizeEmail_(row.email) === normalizeEmail_(actor.email);
  user.can = {
    approve: canDo_(actor, row, 'approve', row.role || 'VIEWER', table),
    reject: canDo_(actor, row, 'reject', null, table),
    suspend: canDo_(actor, row, 'suspend', null, table),
    change_role: canDo_(actor, row, 'changeRole', null, table)
  };
  return user;
}

function handleGetUsers_(ctx) {
  var table = readTable_('Users');
  var counts = { pending: 0, approved: 0, rejected: 0, suspended: 0, total: table.rows.length };
  table.rows.forEach(function (r) {
    if (Object.prototype.hasOwnProperty.call(counts, r.status)) counts[r.status]++;
  });
  var status = String(ctx.payload.status || '');
  var rows = USER_STATUSES.indexOf(status) !== -1
    ? table.rows.filter(function (r) { return r.status === status; })
    : table.rows;
  var users = rows.map(function (r) { return adminUserView_(r, ctx.user, table); });
  users.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  return ok_({ users: users, counts: counts, assignable_roles: assignableRoles_(ctx.user) });
}

function manageUser_(ctx, action) {
  var userId = sanitizeText_(ctx.payload.user_id, 60);
  if (!userId) throw apiError_('BAD_REQUEST', 'ไม่ระบุผู้ใช้');
  var reason = sanitizeText_(ctx.payload.reason, 300);

  var newRole = null;
  if (action === 'approve' || action === 'changeRole') {
    newRole = ctx.payload.role ? String(ctx.payload.role) : null;
    if (action === 'changeRole' && !newRole) throw apiError_('VALIDATION_ERROR', 'กรุณาเลือกสิทธิ์ใหม่');
    if (newRole && ROLES.indexOf(newRole) === -1) throw apiError_('VALIDATION_ERROR', 'สิทธิ์ผู้ใช้ไม่ถูกต้อง');
  }

  return withLock_(function () {
    var table = readTable_('Users');
    var target = null;
    table.rows.forEach(function (r) {
      if (r.user_id === userId) target = r;
    });
    if (!target) throw apiError_('NOT_FOUND', 'ไม่พบผู้ใช้');

    if (action === 'approve' && !newRole) newRole = ROLES.indexOf(target.role) !== -1 ? target.role : 'VIEWER';
    if (action === 'changeRole' && newRole === target.role) {
      throw apiError_('VALIDATION_ERROR', 'ผู้ใช้มีสิทธิ์ ' + newRole + ' อยู่แล้ว');
    }

    assertStatusTransition_(target, action);
    assertCanManage_(ctx.user, target, action, newRole, table);

    var old = { role: target.role, status: target.status };
    var now = nowIso_();
    var auditAction;

    if (action === 'approve') {
      target.status = 'approved';
      target.role = newRole;
      target.approved_at = now;
      target.approved_by = ctx.user.email;
      auditAction = 'APPROVE_USER';
    } else if (action === 'reject') {
      target.status = 'rejected';
      auditAction = 'REJECT_USER';
    } else if (action === 'suspend') {
      target.status = 'suspended';
      auditAction = 'SUSPEND_USER';
    } else {
      target.role = newRole;
      auditAction = 'CHANGE_ROLE';
    }

    updateRows_(table, [target]);
    var newValue = { email: target.email, role: target.role, status: target.status };
    if (reason) newValue.reason = reason;
    writeAuditLog_({
      email: ctx.user.email,
      action: auditAction,
      record_id: target.user_id,
      old_value: old,
      new_value: newValue,
      user_agent: ctx.userAgent
    });

    var messages = {
      approve: 'อนุมัติผู้ใช้เรียบร้อยแล้ว',
      reject: 'ปฏิเสธผู้ใช้เรียบร้อยแล้ว',
      suspend: 'ระงับผู้ใช้เรียบร้อยแล้ว',
      changeRole: 'เปลี่ยนสิทธิ์ผู้ใช้เรียบร้อยแล้ว'
    };
    return ok_({ user: adminUserView_(target, ctx.user, table) }, messages[action]);
  });
}

function handleApproveUser_(ctx) { return manageUser_(ctx, 'approve'); }
function handleRejectUser_(ctx) { return manageUser_(ctx, 'reject'); }
function handleSuspendUser_(ctx) { return manageUser_(ctx, 'suspend'); }
function handleChangeUserRole_(ctx) { return manageUser_(ctx, 'changeRole'); }
