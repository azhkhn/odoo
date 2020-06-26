odoo.define('mail/static/src/models/message/message.js', function (require) {
'use strict';

const emojis = require('mail.emojis');
const { registerNewModel } = require('mail/static/src/model/model_core.js');
const { attr, many2many, many2one, one2many } = require('mail/static/src/model/model_field.js');
const { addLink, parseAndTransform } = require('mail.utils');

const { str_to_datetime } = require('web.time');

function factory(dependencies) {

    class Message extends dependencies['mail.model'] {

        //----------------------------------------------------------------------
        // Public
        //----------------------------------------------------------------------

        /**
         * @static
         * @param {mail.thread} thread
         * @param {string} threadStringifiedDomain
         */
        static checkAll(thread, threadStringifiedDomain) {
            const threadCache = thread.cache(threadStringifiedDomain);
            threadCache.update({ checkedMessages: [['link', threadCache.messages]] });
        }

        /**
         * @static
         * @param {Object} data
         * @return {Object}
         */
        static convertData(data) {
            const data2 = {};
            if ('attachment_ids' in data) {
                if (!data.attachment_ids) {
                    data2.attachments = [['unlink-all']];
                } else {
                    data2.attachments = [
                        ['insert-and-replace', data.attachment_ids.map(attachmentData =>
                            this.env.models['mail.attachment'].convertData(attachmentData)
                        )],
                    ];
                }
            }
            if ('author_id' in data) {
                if (!data.author_id) {
                    data2.author = [['unlink-all']];
                } else if (data.author_id[0] !== 0) {
                    // partner id 0 is a hack of message_format to refer to an
                    // author non-related to a partner. display_name equals
                    // email_from, so this is omitted due to being redundant.
                    data2.author = [
                        ['insert', {
                            display_name: data.author_id[1],
                            id: data.author_id[0],
                        }],
                    ];
                }
            }
            if ('body' in data) {
                data2.body = data.body;
            }
            if ('channel_ids' in data && data.channel_ids) {
                // AKU FIXME: side-effect of calling convert...
                const channelList = [];
                for (const channelId of data.channel_ids) {
                    const channel = this.env.models['mail.thread'].insert({
                        id: channelId,
                        model: 'mail.channel',
                    });
                    channelList.push(channel);
                }
                data2.serverChannels = [['replace', channelList]];
            }
            if ('date' in data && data.date) {
                data2.date = moment(str_to_datetime(data.date));
            }
            if ('email_from' in data) {
                data2.email_from = data.email_from;
            }
            if ('history_partner_ids' in data) {
                data2.isHistory = data.history_partner_ids.includes(this.env.messaging.currentPartner.id);
            }
            if ('id' in data) {
                data2.id = data.id;
            }
            if ('is_discussion' in data) {
                data2.is_discussion = data.is_discussion;
            }
            if ('is_note' in data) {
                data2.is_note = data.is_note;
            }
            if ('is_notification' in data) {
                data2.is_notification = data.is_notification;
            }
            if ('message_type' in data) {
                data2.message_type = data.message_type;
            }
            if ('model' in data && 'res_id' in data && data.model && data.res_id) {
                const originThreadData = {
                    id: data.res_id,
                    model: data.model,
                };
                if ('record_name' in data && data.record_name) {
                    originThreadData.name = data.record_name;
                }
                if ('res_model_name' in data && data.res_model_name) {
                    originThreadData.model_name = data.res_model_name;
                }
                if ('module_icon' in data) {
                    originThreadData.moduleIcon = data.module_icon;
                }
                data2.originThread = [['insert', originThreadData]];
            }
            if ('moderation_status' in data) {
                data2.moderation_status = data.moderation_status;
            }
            if ('needaction_partner_ids' in data) {
                data2.isNeedaction = data.needaction_partner_ids.includes(this.env.messaging.currentPartner.id);
            }
            if ('notifications' in data) {
                data2.notifications = [['insert', data.notifications.map(notificationData =>
                    this.env.models['mail.notification'].convertData(notificationData)
                )]];
            }
            if ('starred_partner_ids' in data) {
                data2.isStarred = data.starred_partner_ids.includes(this.env.messaging.currentPartner.id);
            }
            if ('subject' in data) {
                data2.subject = data.subject;
            }
            if ('subtype_description' in data) {
                data2.subtype_description = data.subtype_description;
            }
            if ('subtype_id' in data) {
                data2.subtype_id = data.subtype_id;
            }
            if ('tracking_value_ids' in data) {
                data2.tracking_value_ids = data.tracking_value_ids;
            }

            return data2;
        }

        /**
         * Mark all messages of current user with given domain as read.
         *
         * @static
         * @param {Array[]} domain
         */
        static async markAllAsRead(domain) {
            await this.env.services.rpc({
                model: 'mail.message',
                method: 'mark_all_as_read',
                kwargs: { domain },
            });
        }

        /**
         * Mark provided messages as read. Messages that have been marked as
         * read are acknowledged by server with response as longpolling
         * notification of following format:
         *
         * [[dbname, 'res.partner', partnerId], { type: 'mark_as_read' }]
         *
         * @see mail.messaging_notification_handler:_handleNotificationPartnerMarkAsRead()
         *
         * @static
         * @param {mail.message[]} messages
         */
        static async markAsRead(messages) {
            await this.env.services.rpc({
                model: 'mail.message',
                method: 'set_message_done',
                args: [messages.map(message => message.id)]
            });
        }

        /**
         * Applies the moderation `decision` on the provided messages.
         *
         * @static
         * @param {mail.message[]} messages
         * @param {string} decision: 'accept', 'allow', ban', 'discard', or 'reject'
         * @param {Object|undefined} [kwargs] optional data to pass on
         *  message moderation. This is provided when rejecting the messages
         *  for which title and comment give reason(s) for reject.
         * @param {string} [kwargs.title]
         * @param {string} [kwargs.comment]
         */
        static async moderate(messages, decision, kwargs) {
            const messageIds = messages.map(message => message.id);
            await this.env.services.rpc({
                model: 'mail.message',
                method: 'moderate',
                args: [messageIds, decision],
                kwargs: kwargs,
            });
        }

        /**
         * @static
         * @param {mail.thread} thread
         * @param {string} threadStringifiedDomain
         */
        static uncheckAll(thread, threadStringifiedDomain) {
            const threadCache = thread.cache(threadStringifiedDomain);
            threadCache.update({ checkedMessages: [['unlink', threadCache.messages]] });
        }

        /**
         * Unstar all starred messages of current user.
         */
        static async unstarAll() {
            await this.env.services.rpc({
                model: 'mail.message',
                method: 'unstar_all',
            });
        }

        /**
         * @param {mail.thread} thread
         * @param {string} threadStringifiedDomain
         * @returns {boolean}
         */
        isChecked(thread, threadStringifiedDomain) {
            // aku todo
            const relatedCheckedThreadCache = this.checkedThreadCaches.find(
                threadCache => (
                    threadCache.thread === thread &&
                    threadCache.stringifiedDomain === threadStringifiedDomain
                )
            );
            return !!relatedCheckedThreadCache;
        }

        /**
         * Mark this message as read, so that it no longer appears in current
         * partner Inbox.
         */
        async markAsRead() {
            await this.async(() => this.env.services.rpc({
                model: 'mail.message',
                method: 'set_message_done',
                args: [[this.id]]
            }));
        }

        /**
         * Applies the moderation `decision` on this message.
         *
         * @param {string} decision: 'accept', 'allow', ban', 'discard', or 'reject'
         * @param {Object|undefined} [kwargs] optional data to pass on
         *  message moderation. This is provided when rejecting the messages
         *  for which title and comment give reason(s) for reject.
         * @param {string} [kwargs.title]
         * @param {string} [kwargs.comment]
         */
        async moderate(decision, kwargs) {
            await this.async(() => this.constructor.moderate([this], decision, kwargs));
        }

        /**
         * Opens the view that allows to resend the message in case of failure.
         */
        openResendAction() {
            this.env.bus.trigger('do-action', {
                action: 'mail.mail_resend_message_action',
                options: {
                    additional_context: {
                        mail_message_to_resend: this.id,
                    },
                },
            });
        }

        /**
         * Action to initiate reply to current message in Discuss Inbox. Assumes
         * that Discuss and Inbox are already opened.
         */
        replyTo() {
            this.env.messaging.discuss.replyToMessage(this);
        }

        /**
         * Toggle check state of this message in the context of the provided
         * thread and its stringifiedDomain.
         *
         * @param {mail.thread} thread
         * @param {string} threadStringifiedDomain
         */
        toggleCheck(thread, threadStringifiedDomain) {
            const threadCache = thread.cache(threadStringifiedDomain);
            if (threadCache.checkedMessages.includes(this)) {
                threadCache.update({ checkedMessages: [['unlink', this]] });
            } else {
                threadCache.update({ checkedMessages: [['link', this]] });
            }
        }

        /**
         * Toggle the starred status of the provided message.
         */
        async toggleStar() {
            await this.async(() => this.env.services.rpc({
                model: 'mail.message',
                method: 'toggle_message_starred',
                args: [[this.id]]
            }));
        }

        //----------------------------------------------------------------------
        // Private
        //----------------------------------------------------------------------

        /**
         * @returns {boolean}
         */
        _computeFailureNotifications() {
            return [['replace', this.notifications.filter(notifications =>
                ['exception', 'bounce'].includes(notifications.notification_status)
            )]];
        }

        /**
         * @private
         * @returns {boolean}
         */
        _computeHasCheckbox() {
            return this.isModeratedByCurrentPartner;
        }

        /**
         * @private
         * @returns {boolean}
         */
        _computeIsCurrentPartnerAuthor() {
            return (
                this.author &&
                this.messagingCurrentPartner &&
                this.messagingCurrentPartner === this.author
            );
        }

        /**
         * @private
         * @returns {boolean}
         */
        _computeIsModeratedByCurrentPartner() {
            return (
                this.moderation_status === 'pending_moderation' &&
                this.originThread &&
                this.originThread.isModeratedByCurrentPartner
            );
        }

        /**
         * @private
         * @returns {mail.messaging}
         */
        _computeMessaging() {
            return [['link', this.env.messaging]];
        }

        /**
         * @private
         * @returns {mail.thread[]}
         */
        _computeNonOriginThreads() {
            const nonOriginThreads = this.serverChannels.filter(thread => thread !== this.originThread);
            if (this.isHistory) {
                nonOriginThreads.push(this.env.messaging.history);
            }
            if (this.isNeedaction) {
                nonOriginThreads.push(this.env.messaging.inbox);
            }
            if (this.isStarred) {
                nonOriginThreads.push(this.env.messaging.starred);
            }
            if (this.env.messaging.moderation && this.isModeratedByCurrentPartner) {
                nonOriginThreads.push(this.env.messaging.moderation);
            }
            return [['replace', nonOriginThreads]];
        }

        /**
         * This value is meant to be based on field body which is
         * returned by the server (and has been sanitized before stored into db).
         * Do not use this value in a 't-raw' if the message has been created
         * directly from user input and not from server data as it's not escaped.
         *
         * @private
         * @returns {string}
         */
        _computePrettyBody() {
            let prettyBody;
            for (const emoji of emojis) {
                const { unicode } = emoji;
                const regexp = new RegExp(
                    `(?:^|\\s|<[a-z]*>)(${unicode})(?=\\s|$|</[a-z]*>)`,
                    "g"
                );
                const originalBody = this.body;
                prettyBody = this.body.replace(
                    regexp,
                    ` <span class="o_mail_emoji">${unicode}</span> `
                );
                // Idiot-proof limit. If the user had the amazing idea of
                // copy-pasting thousands of emojis, the image rendering can lead
                // to memory overflow errors on some browsers (e.g. Chrome). Set an
                // arbitrary limit to 200 from which we simply don't replace them
                // (anyway, they are already replaced by the unicode counterpart).
                if (_.str.count(prettyBody, "o_mail_emoji") > 200) {
                    prettyBody = originalBody;
                }
            }
            // add anchor tags to urls
            return parseAndTransform(prettyBody, addLink);
        }

        /**
         * @private
         * @returns {mail.thread[]}
         */
        _computeThreads() {
            const threads = [...this.nonOriginThreads];
            if (this.originThread) {
                threads.push(this.originThread);
            }
            return [['replace', threads]];
        }

        /**
         * @override
         */
        _createRecordLocalId(data) {
            const Message = this.env.models['mail.message'];
            return `${Message.modelName}_${data.id}`;
        }

    }

    Message.fields = {
        attachments: many2many('mail.attachment', {
            inverse: 'messages',
        }),
        author: many2one('mail.partner', {
            inverse: 'messagesAsAuthor',
        }),
        /**
         * This value is meant to be returned by the server
         * (and has been sanitized before stored into db).
         * Do not use this value in a 't-raw' if the message has been created
         * directly from user input and not from server data as it's not escaped.
         */
        body: attr({
            default: "",
        }),
        checkedThreadCaches: many2many('mail.thread_cache', {
            inverse: 'checkedMessages',
        }),
        date: attr({
            default: moment(),
        }),
        email_from: attr(),
        failureNotifications: one2many('mail.notification', {
            compute: '_computeFailureNotifications',
            dependencies: ['notificationsStatus'],
        }),
        hasCheckbox: attr({
            compute: '_computeHasCheckbox',
            default: false,
            dependencies: ['isModeratedByCurrentPartner'],
        }),
        id: attr(),
        isCurrentPartnerAuthor: attr({
            compute: '_computeIsCurrentPartnerAuthor',
            default: false,
            dependencies: [
                'author',
                'messagingCurrentPartner',
            ],
        }),
        isModeratedByCurrentPartner: attr({
            compute: '_computeIsModeratedByCurrentPartner',
            default: false,
            dependencies: [
                'moderation_status',
                'originThread',
                'originThreadIsModeratedByCurrentPartner',
            ],
        }),
        isTemporary: attr({
            default: false,
        }),
        isTransient: attr({
            default: false,
        }),
        is_discussion: attr({
            default: false,
        }),
        /**
         * Determine whether the message was a needaction. Useful to make it
         * present in history mailbox.
         */
        isHistory: attr({
            default: false,
        }),
        /**
         * Determine whether the message is needaction. Useful to make it
         * present in inbox mailbox and messaging menu.
         */
        isNeedaction: attr({
            default: false,
        }),
        is_note: attr({
            default: false,
        }),
        is_notification: attr({
            default: false,
        }),
        /**
         * Determine whether the message is starred. Useful to make it present
         * in starred mailbox.
         */
        isStarred: attr({
            default: false,
        }),
        message_type: attr(),
        messaging: many2one('mail.messaging', {
            compute: '_computeMessaging',
        }),
        messagingCurrentPartner: many2one('mail.partner', {
            related: 'messaging.currentPartner',
        }),
        messagingHistory: many2one('mail.thread', {
            related: 'messaging.history',
        }),
        messagingInbox: many2one('mail.thread', {
            related: 'messaging.inbox',
        }),
        messagingModeration: many2one('mail.thread', {
            related: 'messaging.moderation',
        }),
        messagingStarred: many2one('mail.thread', {
            related: 'messaging.starred',
        }),
        moderation_status: attr(),
        /**
         * List of non-origin threads that this message is linked to. This field
         * is read-only.
         */
        nonOriginThreads: many2many('mail.thread', {
            compute: '_computeNonOriginThreads',
            dependencies: [
                'isHistory',
                'isModeratedByCurrentPartner',
                'isNeedaction',
                'isStarred',
                'messagingHistory',
                'messagingInbox',
                'messagingModeration',
                'messagingStarred',
                'originThread',
                'serverChannels',
            ],
        }),
        notifications: one2many('mail.notification', {
            inverse: 'message',
            isCausal: true,
        }),
        notificationsStatus: attr({
            default: [],
            related: 'notifications.notification_status',
        }),
        /**
         * Origin thread of this message (if any).
         */
        originThread: many2one('mail.thread'),
        originThreadIsModeratedByCurrentPartner: attr({
            default: false,
            related: 'originThread.isModeratedByCurrentPartner',
        }),
        /**
         * This value is meant to be based on field body which is
         * returned by the server (and has been sanitized before stored into db).
         * Do not use this value in a 't-raw' if the message has been created
         * directly from user input and not from server data as it's not escaped.
         */
        prettyBody: attr({
            compute: '_computePrettyBody',
            dependencies: ['body'],
        }),
        subject: attr(),
        subtype_description: attr(),
        subtype_id: attr(),
        /**
         * All threads that this message is linked to. This field is read-only.
         */
        threads: many2many('mail.thread', {
            compute: '_computeThreads',
            dependencies: [
                'originThread',
                'nonOriginThreads',
            ],
            inverse: 'messages',
        }),
        tracking_value_ids: attr({
            default: [],
        }),

        /**
         * All channels that this message is linked to (from server message
         * format).
         */
        serverChannels: many2many('mail.thread'),
    };

    Message.modelName = 'mail.message';

    return Message;
}

registerNewModel('mail.message', factory);

});
